// index.js - Complete Tournament Bot Application

// --- Imports ---
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
// NOTE: Replaced 'canvas' with '@napi-rs/canvas' for improved performance.
const { createCanvas, loadImage } = require('@napi-rs/canvas'); 
// NOTE: We assume a modern Node.js environment with global fetch. 

// --- Configuration & Initialization ---
const TOKEN = process.env.DISCORD_TOKEN; 
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
// CRITICAL FIX: Use the port provided by the hosting environment (process.env.PORT) 
// and fall back to 3000 for local testing.
const PORT = process.env.PORT || 3000; 
const DISCORD_API_BASE = 'https://discord.com/api/v10';
// NOTE: REDIRECT_URI is now only needed for the "Invite Bot" OAuth flow
const REDIRECT_URI = 'http://localhost:3000/discord/callback'; 
const SCOPES = 'identify guilds';
const BOT_PERMISSIONS = '8'; // Administrator (or specific permissions like 268435456 for Manage Guild)

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const app = express();

// Global state for the single active tournament
const tournamentState = {
    isActive: false,
    channelId: null,
    messageId: null,
    // Participants stored as { id: 'userID', username: 'username', status: 'R1' }
    participants: [], 
    details: {},
    bracket: [] // Structured array for pairings and advancement
};

// --- UTILITY FUNCTIONS ---

/**
 * Generates initial pairings for a single-elimination tournament.
 * Uses a simple bracket structure for demonstration.
 * @param {Array<{id: string, username: string}>} players 
 * @returns {Array<{p1: string, p2: string, matchId: number, winner: string | null}>}
 */
function generatePairings(players) {
    // Clone and shuffle players for fair initial pairing
    const shuffledPlayers = [...players].sort(() => 0.5 - Math.random());
    
    // Pad with 'BYE' if count is not a power of 2
    let nextPowerOfTwo = 1;
    while (nextPowerOfTwo < shuffledPlayers.length) {
        nextPowerOfTwo *= 2;
    }
    const padding = nextPowerOfTwo - shuffledPlayers.length;
    for (let i = 0; i < padding; i++) {
        shuffledPlayers.push({ id: 'BYE', username: 'BYE' });
    }

    const pairings = [];
    for (let i = 0; i < shuffledPlayers.length / 2; i++) {
        pairings.push({
            matchId: i + 1,
            p1: shuffledPlayers[i].username,
            p2: shuffledPlayers[shuffledPlayers.length - 1 - i].username,
            winner: null
        });
    }
    
    return pairings;
}

/**
 * Draws the tournament bracket using the canvas library.
 * @param {Array<{p1: string, p2: string, matchId: number, winner: string | null}>} pairings - The current round's matches.
 * @returns {Promise<Buffer>} - A promise that resolves to a PNG image buffer.
 */
async function drawTournamentBracket(pairings) {
    // Constants for drawing (no change, keeping the existing drawing logic)
    const WIDTH = 800;
    const HEIGHT = 600;
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    const BOX_HEIGHT = 40;
    const BOX_WIDTH = 180;
    const FONT_SIZE = 16;
    const LINE_COLOR = '#6366f1'; 
    const TEXT_COLOR = '#f3f4f6';
    const WINNER_COLOR = '#4ade80'; 

    // Background
    ctx.fillStyle = '#111827'; 
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    // Setup Font
    ctx.font = `${FONT_SIZE}px sans-serif`;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'left';

    // Title
    ctx.fillText('Tournament Bracket - Current Round', 20, 30);
    
    const startY = 60;
    const startX = 20;

    // Draw Matches
    pairings.forEach((match, index) => {
        const y = startY + index * (BOX_HEIGHT * 2 + 10);
        
        // Match Box Outline
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(startX, y, BOX_WIDTH, BOX_HEIGHT * 2);

        // Player 1
        let p1Color = match.winner === match.p1 ? WINNER_COLOR : TEXT_COLOR;
        ctx.fillStyle = p1Color;
        ctx.fillText(match.p1, startX + 10, y + BOX_HEIGHT / 2 + 5);
        
        // Player 2
        let p2Color = match.winner === match.p2 ? WINNER_COLOR : TEXT_COLOR;
        ctx.fillStyle = p2Color;
        ctx.fillText(match.p2, startX + 10, y + BOX_HEIGHT * 1.5 + 5);

        // Separator Line
        ctx.beginPath();
        ctx.moveTo(startX, y + BOX_HEIGHT);
        ctx.lineTo(startX + BOX_WIDTH, y + BOX_HEIGHT);
        ctx.strokeStyle = LINE_COLOR;
        ctx.stroke();

        // Line connecting to next round placeholder
        const midY = y + BOX_HEIGHT;
        ctx.beginPath();
        ctx.moveTo(startX + BOX_WIDTH, midY);
        ctx.lineTo(startX + BOX_WIDTH + 50, midY); // Horizontal connector
        ctx.stroke();

        // Draw winner placeholder
        ctx.fillStyle = '#a1a1aa';
        if (match.winner) {
            ctx.fillStyle = WINNER_COLOR;
            ctx.fillText(`> ${match.winner}`, startX + BOX_WIDTH + 60, midY + 5);
        } else {
             ctx.fillText('WINNER PENDING', startX + BOX_WIDTH + 60, midY + 5);
        }

        ctx.fillStyle = TEXT_COLOR; // Reset color
    });

    // The toBuffer() method is standard across canvas implementations
    return canvas.toBuffer('image/png');
}

/**
 * Updates the Discord message with the latest participants and bracket image.
 */
async function updateTournamentPost() {
    if (!tournamentState.messageId || !tournamentState.channelId) return;

    try {
        const channel = await client.channels.fetch(tournamentState.channelId);
        const message = await channel.messages.fetch(tournamentState.messageId);

        // If the bracket is empty, generate initial pairings from participants
        if (tournamentState.bracket.length === 0 && tournamentState.participants.length > 1) {
            tournamentState.bracket = generatePairings(tournamentState.participants);
        }
        
        // Generate the Bracket Image
        const imageBuffer = await drawTournamentBracket(tournamentState.bracket);
        
        // Prepare the list of participants for the embed
        const participantList = tournamentState.participants.length > 0 
            ? tournamentState.participants.map(p => `• ${p.username}`).join('\n') 
            : 'No one has joined yet.';
        
        // Create the new embed
        const newEmbed = new EmbedBuilder()
            .setTitle(`🏆 ${tournamentState.details.name}`)
            .setDescription(`React with ✅ below to join! Current participants:`)
            .addFields(
                { name: 'Prize', value: tournamentState.details.prize, inline: true },
                { name: 'Entry Fee', value: tournamentState.details.entryFee || 'Free', inline: true },
                { name: `Participants (${tournamentState.participants.length})`, value: participantList.substring(0, 1024), inline: false }
            )
            .setColor(0x6366f1) // Accent color
            .setImage('attachment://tournament-bracket.png'); // Reference the attached image
            
        // Edit the message with the new embed and the generated image
        await message.edit({ 
            embeds: [newEmbed], 
            files: [{ 
                attachment: imageBuffer, 
                name: 'tournament-bracket.png' 
            }] 
        });

    } catch (e) {
        console.error('Failed to update tournament post:', e);
    }
}

/**
 * Generates the HTML form with dynamic server and channel selection logic.
 * @param {string} loginContent - Content to display instead of the form (e.g., login button or guild list).
 * @returns {string} The full HTML content.
 */
function getWebpageHtml(loginContent = 'login') {
    // New default form structure with select elements
    const defaultForm = `
        <p>Define the parameters to launch the tournament registration on Discord.</p>
        <form action="/start-tournament" method="POST">
            <label for="name">Tournament Name</label>
            <input type="text" id="name" name="name" placeholder="e.g., Spring Smash 2024" required>
            
            <label for="prize">Prize Details</label>
            <input type="text" id="prize" name="prize" placeholder="e.g., $50 Nitro, Custom Role" required>
            
            <label for="entryFee">Entry Fee (Optional)</label>
            <input type="text" id="entryFee" name="entryFee" placeholder="e.g., Free, 5,000 Gold, or None">

            <label for="guildId">Target Discord Server</label>
            <select id="guildId" name="guildId" required>
                <option value="" disabled selected>Loading Servers...</option>
            </select>
            
            <label for="channelId">Target Discord Channel</label>
            <select id="channelId" name="channelId" required disabled>
                <option value="" disabled selected>Select a Server First</option>
            </select>
            
            <button type="submit">🚀 Launch Registration Event</button>
        </form>
    `;

    const loginButton = `
        <p>Login with Discord to invite the bot to a new server:</p>
        <a href="/discord/login" style="text-decoration: none;">
            <button type="button" style="background-color: #5865F2; /* Discord Blurple */">
                🔗 Login with Discord to Invite Bot
            </button>
        </a>
        <hr style="border-top: 1px solid var(--border-color); margin: 30px 0;">
        <p>Or start a tournament in a server where the bot is already added:</p>
        ${defaultForm}
    `;

    const contentToDisplay = loginContent === 'login' ? loginButton : loginContent;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tournament Bot Manager</title>
        <style>
            :root {
                --bg-color: #0c0c0c;
                --card-color: #1f1f1f;
                --text-color: #f3f4f6;
                --input-bg: #2d2d2d;
                --border-color: #3f3f3f;
                --accent-color: #6366f1; 
                --success-color: #4ade80; 
                --error-color: #ef4444; 
            }

            body {
                background-color: var(--bg-color);
                color: var(--text-color);
                font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            
            .card-container {
                max-width: 500px;
                width: 100%;
                background-color: var(--card-color);
                padding: 2.5rem;
                border-radius: 1rem;
                border: 1px solid var(--border-color);
                box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
            }

            h1 {
                font-size: 1.875rem;
                font-weight: 700;
                margin-bottom: 0.5rem;
                color: var(--text-color);
                text-align: center;
            }
            
            p {
                color: #a1a1aa;
                margin-bottom: 2rem;
                text-align: center;
            }

            label {
                display: block;
                font-size: 0.875rem;
                font-weight: 500;
                margin-bottom: 0.5rem;
                color: var(--text-color);
            }

            input[type="text"], select {
                width: 100%;
                padding: 0.75rem 1rem;
                margin-bottom: 1.5rem;
                background-color: var(--input-bg);
                border: 1px solid var(--border-color);
                border-radius: 0.5rem;
                color: var(--text-color);
                transition: border-color 0.2s, box-shadow 0.2s;
                box-sizing: border-box;
            }
            
            input[type="text"]:focus, select:focus {
                border-color: var(--accent-color);
                outline: none;
                box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.4);
            }
            
            button {
                width: 100%;
                padding: 0.75rem;
                background-color: var(--accent-color);
                color: white;
                font-weight: 600;
                border: none;
                border-radius: 0.5rem;
                cursor: pointer;
                transition: background-color 0.2s, transform 0.1s;
                font-size: 1rem;
                letter-spacing: 0.05em;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
                margin-top: 10px;
            }

            button:hover {
                background-color: #4f46e5;
            }
            
            button:active {
                transform: scale(0.99);
            }

            /* Guild List Specific Styles - Retained for OAuth Success Page */
            .guild-list {
                list-style: none;
                padding: 0;
            }
            .guild-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 0;
                border-bottom: 1px solid var(--border-color);
            }
            .guild-item:last-child {
                border-bottom: none;
            }
            .guild-invite-btn {
                background-color: var(--success-color);
                color: #111827;
                padding: 8px 12px;
                border-radius: 0.5rem;
                text-decoration: none;
                font-weight: 700;
                transition: background-color 0.2s;
            }
            .guild-invite-btn:hover {
                background-color: #22c55e; /* Tailwind green-500 */
            }
            .guild-name {
                font-weight: 600;
            }

            /* Message Styling (unchanged) */
            .message-box {
                padding: 1.5rem;
                border-radius: 0.5rem;
                margin-top: 20px;
                text-align: center;
            }
            .message-box.success {
                background-color: rgba(74, 222, 128, 0.1);
                border: 1px solid var(--success-color);
                color: var(--success-color);
            }
            .message-box.error {
                background-color: rgba(239, 68, 68, 0.1);
                border: 1px solid var(--error-color);
                color: var(--error-color);
            }
            .message-box h2 {
                margin-top: 0;
                font-size: 1.5rem;
            }
            .message-box a {
                color: var(--success-color);
                text-decoration: none;
                font-weight: 600;
            }
            .message-box a:hover {
                text-decoration: underline;
            }
        </style>
        <script>
            // Client-side logic for dynamic Server and Channel selection
            document.addEventListener('DOMContentLoaded', () => {
                const guildSelect = document.getElementById('guildId');
                const channelSelect = document.getElementById('channelId');
                const form = document.querySelector('form[action="/start-tournament"]');

                if (!guildSelect || !channelSelect || !form) return;

                // 1. Fetch and populate the Server/Guild dropdown
                const populateGuilds = async () => {
                    try {
                        const response = await fetch('/api/guilds');
                        const guilds = await response.json();

                        guildSelect.innerHTML = '<option value="" disabled selected>Select a Server</option>';

                        if (guilds.length === 0) {
                            guildSelect.innerHTML = '<option value="" disabled selected>Bot not in any server</option>';
                            guildSelect.disabled = true;
                            return;
                        }

                        guilds.forEach(guild => {
                            const option = document.createElement('option');
                            option.value = guild.id;
                            option.textContent = guild.name;
                            guildSelect.appendChild(option);
                        });
                        guildSelect.disabled = false;

                    } catch (error) {
                        console.error('Error fetching guilds:', error);
                        guildSelect.innerHTML = '<option value="" disabled selected>Error loading servers</option>';
                    }
                };
                
                // 2. Event listener for when a Server is selected
                guildSelect.addEventListener('change', async (e) => {
                    const guildId = e.target.value;
                    channelSelect.innerHTML = '<option value="" disabled selected>Loading Channels...</option>';
                    channelSelect.disabled = true;

                    if (!guildId) return;

                    try {
                        const response = await fetch(\`/api/channels/\${guildId}\`);
                        const channels = await response.json();

                        channelSelect.innerHTML = '<option value="" disabled selected>Select a Channel</option>';
                        
                        if (channels.length === 0) {
                            channelSelect.innerHTML = '<option value="" disabled selected>No Text Channels found</option>';
                        } else {
                            channels.forEach(channel => {
                                const option = document.createElement('option');
                                option.value = channel.id;
                                option.textContent = \`# \${channel.name}\`;
                                channelSelect.appendChild(option);
                            });
                            channelSelect.disabled = false;
                        }

                    } catch (error) {
                        console.error('Error fetching channels:', error);
                        channelSelect.innerHTML = '<option value="" disabled selected>Error loading channels</option>';
                    }
                });

                // Initialize the guild population after a brief delay to ensure the bot client is ready
                setTimeout(populateGuilds, 500);
            });
        </script>
    </head>
    <body>
        <div class="card-container">
            <h1>Tournament Bot 🤖</h1>
            ${contentToDisplay}
        </div>
    </body>
    </html>
    `;
}

/**
 * Generates the HTML to list invitable guilds (Only used after OAuth login for bot invite).
 * @param {Array<Object>} guilds - List of guilds the user is in.
 * @returns {string} HTML content.
 */
function getGuildListHtml(guilds) {
    const invitableGuilds = guilds.filter(guild => {
        // Check for Administrator permission (8)
        const permission = BigInt(guild.permissions);
        const administrator = BigInt(0x8);
        return (permission & administrator) === administrator;
    });

    if (invitableGuilds.length === 0) {
        return `
            <p style="color: var(--error-color);">You do not have Administrator permissions in any server to invite the bot.</p>
            <p>Please ensure you are logged into the correct Discord account.</p>
            <a href="/" style="text-decoration: none;"><button>Go Back</button></a>
        `;
    }

    const guildItems = invitableGuilds.map(guild => {
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${BOT_PERMISSIONS}&scope=bot&guild_id=${guild.id}`;
        return `
            <li class="guild-item">
                <span class="guild-name">${guild.name}</span>
                <a class="guild-invite-btn" href="${inviteUrl}" target="_blank">Invite Bot</a>
            </li>
        `;
    }).join('');

    return `
        <div class="message-box success">
            <h2>Success!</h2>
            <p>Logged in. Select a server to invite the bot:</p>
        </div>
        <ul class="guild-list">
            ${guildItems}
        </ul>
        <hr style="border-top: 1px solid var(--border-color); margin: 30px 0;">
        <p>Return to the homepage to use the tournament setup form with servers the bot is already in.</p>
        <a href="/" style="text-decoration: none;"><button>Return to Setup Form</button></a>
    `;
}

// --- EXPRESS SERVER (REPLIT PREVIEW) ---
app.use(bodyParser.urlencoded({ extended: true }));

// GET route: Serves the styled HTML form (or login/guild list)
app.get('/', (req, res) => {
    // Ensure the bot is ready before serving the page that relies on its cache
    if (client.isReady()) {
        res.send(getWebpageHtml('login'));
    } else {
        res.status(503).send('<body style="background: var(--bg-color); color: var(--text-color); font-family: \'Inter\', sans-serif;">Bot not ready. Please wait a moment and refresh.</body>');
    }
});

// NEW API Endpoint: Get list of guilds the bot is in
app.get('/api/guilds', (req, res) => {
    if (!client.isReady()) {
        return res.status(503).json([]);
    }

    const guilds = client.guilds.cache.map(guild => ({
        id: guild.id,
        name: guild.name,
    })).sort((a, b) => a.name.localeCompare(b.name));

    res.json(guilds);
});

// NEW API Endpoint: Get text channels for a specific guild
app.get('/api/channels/:guildId', async (req, res) => {
    if (!client.isReady()) {
        return res.status(503).json([]);
    }
    const guildId = req.params.guildId;

    try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) {
            return res.status(404).json([]);
        }

        // Fetch all channels, then filter for text channels
        const channels = await guild.channels.fetch();
        const textChannels = channels
            .filter(channel => channel.type === ChannelType.GuildText)
            .map(channel => ({
                id: channel.id,
                name: channel.name,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(textChannels);

    } catch (error) {
        console.error(`Error fetching channels for guild ${guildId}:`, error);
        res.status(500).json([]);
    }
});

// Route 1: Redirects user to Discord's authorization page (For Bot Invite)
app.get('/discord/login', (req, res) => {
    if (!CLIENT_ID) {
        return res.status(500).send('<body style="background: black; color: white;">CLIENT_ID not set in environment variables. Cannot proceed with OAuth.</body>');
    }
    const url = `${DISCORD_API_BASE}/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;
    res.redirect(url);
});

// Route 2: Receives the authorization code and exchanges it for an access token (For Bot Invite)
app.get('/discord/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        // User may have denied access, return to the form
        return res.redirect('/'); 
    }

    try {
        // Exchange code for token
        const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                scope: SCOPES,
            }),
        });

        const tokenData = await tokenResponse.json();
        const { access_token } = tokenData;

        if (!access_token) {
            console.error('Discord Token Error:', tokenData);
            throw new Error('Failed to obtain access token.');
        }

        // Use token to get user's guilds
        const guildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });

        const guilds = await guildsResponse.json();

        if (!Array.isArray(guilds)) {
            console.error('Discord Guilds Error:', guilds);
            throw new Error('Failed to retrieve user guilds.');
        }

        // Render the list of invitable guilds
        res.send(getWebpageHtml(getGuildListHtml(guilds)));

    } catch (error) {
        console.error('OAuth Flow Error:', error);
        res.status(500).send(getWebpageHtml(`
            <div class="message-box error">
                <h2>Authentication Error</h2>
                <p>Could not complete the Discord login process. Please check your **CLIENT_ID** and **CLIENT_SECRET**.</p>
                <p>Details: ${error.message}</p>
                <a href="/">Try Logging In Again</a>
            </div>
        `));
    }
});

// POST route: Handles the form submission to start the tournament (UPDATED)
app.post('/start-tournament', async (req, res) => {
    if (tournamentState.isActive) {
        return res.status(400).send(`
            <body style="background: var(--bg-color); color: var(--text-color); font-family: 'Inter', sans-serif;">
                <div class="card-container">
                    <div class="message-box error">
                        <h2>Error!</h2>
                        <p>A tournament is already active in <#${tournamentState.channelId}>. Please use Discord commands to end it first.</p>
                        <a href="/">Go Back</a>
                    </div>
                </div>
            </body>
        `);
    }

    // Now receiving guildId and channelId separately
    const { name, prize, guildId, channelId, entryFee } = req.body;
    
    // Simple validation
    if (!name || !prize || !guildId || !channelId) {
        return res.status(400).send('<body style="background: black; color: white;">Missing required details (Name, Prize, Server ID, or Channel ID).</body>');
    }
    
    let htmlResponse;
    try {
        const channel = await client.channels.fetch(channelId);
        // ChannelType.GuildText = 0
        if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== guildId) { 
            throw new Error('Invalid Channel ID or Channel does not belong to the selected server.');
        }

        // 1. Reset and Update Global State
        tournamentState.isActive = true;
        tournamentState.channelId = channelId;
        tournamentState.details = { name, prize, entryFee: entryFee || 'None', organizer: 'Web App' };
        tournamentState.participants = [];
        tournamentState.bracket = [];
        
        // 2. Create and Post Initial Embed
        const initialEmbed = new EmbedBuilder()
            .setTitle(`🏆 TOURNAMENT REGISTRATION: ${name}`)
            .setDescription(`**Join now!** React with the **✅** emoji below to register for the tournament.`)
            .addFields(
                { name: 'Prize Pool', value: prize, inline: true },
                { name: 'Entry Fee', value: entryFee || 'Free', inline: true },
                { name: 'Participants', value: '0 registered', inline: false }
            )
            .setColor(0x6366f1); // Accent color

        const message = await channel.send({ 
            embeds: [initialEmbed],
            // Attach a blank image initially so we can edit it later.
            files: [{ 
                attachment: await drawTournamentBracket([]), 
                name: 'tournament-bracket.png' 
            }]
        });
        await message.react('✅'); 
        
        tournamentState.messageId = message.id;

        htmlResponse = `
            <div class="message-box success">
                <h2>Success!</h2>
                <p>Tournament **${name}** launched in Discord server **${channel.guild.name}**, channel <a href="https://discord.com/channels/${channel.guildId}/${channelId}" target="_blank">#${channel.name}</a>.</p>
                <p>Registrations are now open.</p>
                <a href="/">Launch Another Event</a>
            </div>
        `;

    } catch (error) {
        console.error('Error starting tournament:', error);
        htmlResponse = `
            <div class="message-box error">
                <h2>Error</h2>
                <p>Could not start tournament.</p>
                <p>Details: ${error.message}</p>
                <a href="/">Go Back and Fix</a>
            </div>
        `;
    }
    
    // Render the response page with the success/error message
    res.send(`
        <body style="background: var(--bg-color); color: var(--text-color); font-family: 'Inter', sans-serif;">
            <style>
                :root {--bg-color: #0c0c0c;--card-color: #1f1f1f;--text-color: #f3f4f6;--input-bg: #2d2d2d;--border-color: #3f3f3f;--accent-color: #6366f1;--success-color: #4ade80;--error-color: #ef4444;}
                body {background-color: var(--bg-color);color: var(--text-color);font-family: 'Inter', sans-serif;margin: 0;min-height: 100vh;display: flex;align-items: center;justify-content: center;padding: 20px;}
                .card-container {max-width: 500px;width: 100%;background-color: var(--card-color);padding: 2.5rem;border-radius: 1rem;border: 1px solid var(--border-color);box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);}
                .message-box {padding: 1.5rem;border-radius: 0.5rem;margin-top: 20px;text-align: center;}
                .message-box.success {background-color: rgba(74, 222, 128, 0.1);border: 1px solid var(--success-color);color: var(--success-color);}
                .message-box.error {background-color: rgba(239, 68, 68, 0.1);border: 1px solid var(--error-color);color: var(--error-color);}
                .message-box h2 {margin-top: 0;font-size: 1.5rem;}
                .message-box a {color: var(--success-color);text-decoration: none;font-weight: 600;}
                .message-box a:hover {text-decoration: underline;}
            </style>
            <div class="card-container">${htmlResponse}</div>
        </body>
    `);
});


// --- DISCORD BOT LOGIC ---

client.on('ready', () => {
    console.log(`Bot is logged in as ${client.user.tag}!`);
    
    // Register the slash command
    const updateWinnerCommand = new SlashCommandBuilder()
        .setName('updatewinner')
        .setDescription('Advances the specified user to the next round of the active tournament.')
        .addUserOption(option => 
            option.setName('winner')
                .setDescription('The user who won the match to be advanced.')
                .setRequired(true));

    client.application.commands.create(updateWinnerCommand.toJSON());
});

// Handler for the Reaction Sign-up
client.on('messageReactionAdd', async (reaction, user) => {
    // Only process reactions on the registration message, for the tick emoji, and not from the bot itself
    if (user.bot || reaction.message.id !== tournamentState.messageId || reaction.emoji.name !== '✅') return;
    if (!tournamentState.isActive) return;

    // Fetch the full user details if not cached (needed for username)
    const fetchedUser = await client.users.fetch(user.id);

    // Check if user is already in the list
    if (!tournamentState.participants.some(p => p.id === fetchedUser.id)) {
        tournamentState.participants.push({ id: fetchedUser.id, username: fetchedUser.username });
        console.log(`${fetchedUser.username} joined the tournament.`);
        // Update the post for "live" effect
        await updateTournamentPost();
    }
});

// Handler for the /updatewinner command
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'updatewinner') return;
    if (!tournamentState.isActive) {
        return interaction.reply({ content: 'No active tournament to update.', ephemeral: true });
    }

    const winner = interaction.options.getUser('winner');
    const winnerUsername = winner.username;
    
    // --- ADVANCEMENT LOGIC ---
    let matchFound = false;
    let advancedToNextRound = false;

    // Find the match the winner was in
    for (const match of tournamentState.bracket) {
        if (!match.winner && (match.p1 === winnerUsername || match.p2 === winnerUsername)) {
            match.winner = winnerUsername;
            matchFound = true;
            advancedToNextRound = true;
            
            // Handle BYE match
            if (match.p1 === 'BYE' || match.p2 === 'BYE') {
                 await interaction.reply({ content: `**${winnerUsername}** automatically advanced due to a BYE.`, ephemeral: true });
            } else {
                 await interaction.reply({ content: `**${winnerUsername}** has won their match and advanced! Updating bracket...`, ephemeral: true });
            }
            break;
        }
    }

    if (!matchFound) {
        return interaction.reply({ content: `Could not find an active match for **${winnerUsername}**. Have they already advanced?`, ephemeral: true });
    }
    
    // After a winner is declared, update the pairings structure (simplified for example)
    if (advancedToNextRound) {
        const allComplete = tournamentState.bracket.every(m => m.winner !== null);
        if (allComplete && tournamentState.bracket.length > 1) {
            const winners = tournamentState.bracket.map(m => tournamentState.participants.find(p => p.username === m.winner)).filter(p => p !== undefined);
            tournamentState.bracket = generatePairings(winners);
            if (tournamentState.bracket.length === 1) {
                 // Final winner!
                 const finalWinner = tournamentState.bracket[0].p1;
                 await interaction.followUp({ content: `🎉 **${finalWinner}** has won the entire tournament! Congratulations!`, ephemeral: false });
                 tournamentState.isActive = false;
            }
        }
        
        await updateTournamentPost(); 
    }
});

// --- Start Services ---
client.login(TOKEN);
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));
