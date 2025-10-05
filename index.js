// index.js - Complete Tournament Bot Application for Cloud Hosting (Render/Vercel/etc.)

// --- Imports ---
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const { createCanvas, loadImage } = require('@napi-rs/canvas'); 

// --- Configuration & Initialization ---

// Read environment variables (MUST be set in your Render dashboard)
const TOKEN = process.env.DISCORD_TOKEN; 
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

// 1. DYNAMIC PORT: Use the port provided by the hosting environment (process.env.PORT) 
const PORT = process.env.PORT || 3000; 

// 2. DYNAMIC PUBLIC URL: Use the external web address.
// IMPORTANT: The environment variable PUBLIC_URL takes precedence. If not set, we use your specific Render URL.
const RENDER_HOST_URL = 'https://bread-tournament-bot.onrender.com';
const PUBLIC_URL = process.env.PUBLIC_URL || RENDER_HOST_URL || `http://localhost:${PORT}`;

const DISCORD_API_BASE = 'https://discord.com/api/v10';
// The REDIRECT_URI is now constructed using the PUBLIC_URL
const REDIRECT_URI = `${PUBLIC_URL}/discord/callback`; 
const SCOPES = 'identify guilds'; // We need 'guilds' to see which servers the user is in
const BOT_PERMISSIONS = '8'; // Administrator

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
    // Participants stored as { id: 'userID', username: 'username' }
    participants: [], 
    details: {},
    bracket: [] // Structured array for pairings and advancement
};

// --- UTILITY FUNCTIONS ---

/**
 * Generates initial pairings for a single-elimination tournament.
 * Pads with 'BYE' if player count is not a power of 2.
 * @param {Array<{id: string, username: string}>} players 
 * @returns {Array<{p1: string, p2: string, matchId: number, winner: string | null}>}
 */
function generatePairings(players) {
    const shuffledPlayers = [...players].sort(() => 0.5 - Math.random());
    
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
 * [Bracket drawing logic remains unchanged]
 */
async function drawTournamentBracket(pairings) {
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

    ctx.fillStyle = '#111827'; 
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    
    ctx.font = `${FONT_SIZE}px sans-serif`;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'left';

    ctx.fillText('Tournament Bracket - Current Round', 20, 30);
    
    const startY = 60;
    const startX = 20;

    // Draw Matches
    pairings.forEach((match, index) => {
        const y = startY + index * (BOX_HEIGHT * 2 + 10);
        
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
        ctx.lineTo(startX + BOX_WIDTH + 50, midY); 
        ctx.stroke();

        // Draw winner placeholder
        ctx.fillStyle = '#a1a1aa';
        if (match.winner) {
            ctx.fillStyle = WINNER_COLOR;
            ctx.fillText(`> ${match.winner}`, startX + BOX_WIDTH + 60, midY + 5);
        } else {
             ctx.fillText('WINNER PENDING', startX + BOX_WIDTH + 60, midY + 5);
        }

        ctx.fillStyle = TEXT_COLOR; 
    });

    return canvas.toBuffer('image/png');
}

/**
 * Updates the Discord message with the latest participants and bracket image.
 * [Update post logic remains unchanged]
 */
async function updateTournamentPost() {
    if (!tournamentState.messageId || !tournamentState.channelId) return;

    try {
        const channel = await client.channels.fetch(tournamentState.channelId);
        const message = await channel.messages.fetch(tournamentState.messageId);

        if (tournamentState.bracket.length === 0 && tournamentState.participants.length > 1) {
            tournamentState.bracket = generatePairings(tournamentState.participants);
        }
        
        const imageBuffer = await drawTournamentBracket(tournamentState.bracket);
        
        const participantList = tournamentState.participants.length > 0 
            ? tournamentState.participants.map(p => `• ${p.username}`).join('\n') 
            : 'No one has joined yet.';
        
        const newEmbed = new EmbedBuilder()
            .setTitle(`🏆 ${tournamentState.details.name}`)
            .setDescription(`React with ✅ below to join! Current participants:`)
            .addFields(
                { name: 'Prize', value: tournamentState.details.prize, inline: true },
                { name: 'Entry Fee', value: tournamentState.details.entryFee || 'Free', inline: true },
                { name: `Participants (${tournamentState.participants.length})`, value: participantList.substring(0, 1024), inline: false }
            )
            .setColor(0x6366f1) 
            .setImage('attachment://tournament-bracket.png'); 
            
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
 * Generates the HTML based on whether the user is logged in, or if custom content is provided.
 * * @param {Array<Object> | null} filteredGuilds - List of guilds the user is in AND the bot is in (for management form).
 * @param {string | null} customContent - HTML to display instead of the form or login prompt.
 * @returns {string} The full HTML content.
 */
function getWebpageHtml(filteredGuilds = null, customContent = null) {
    // --- 1. Generate the dropdown options based on the provided, filtered list ---
    let guildOptions = '<option value="" disabled selected>Select a Server</option>';
    let formDisabled = 'disabled';
    
    if (filteredGuilds && filteredGuilds.length > 0) {
        formDisabled = '';
        const sortedGuilds = filteredGuilds.sort((a, b) => a.name.localeCompare(b.name));
        guildOptions = sortedGuilds.map(guild => 
            `<option value="${guild.id}">${guild.name}</option>`
        ).join('');
    } else if (filteredGuilds) {
        // Logged in, but bot is not in any of the user's servers
        guildOptions = '<option value="" disabled selected>Bot not in any of your servers</option>';
    }

    // --- 2. The main form content ---
    const setupForm = `
        <p>Define the parameters to launch the tournament registration on Discord.</p>
        <form action="/start-tournament" method="POST">
            <label for="name">Tournament Name</label>
            <input type="text" id="name" name="name" placeholder="e.g., Spring Smash 2024" required>
            
            <label for="prize">Prize Details</label>
            <input type="text" id="prize" name="prize" placeholder="e.g., $50 Nitro, Custom Role" required>
            
            <label for="entryFee">Entry Fee (Optional)</label>
            <input type="text" id="entryFee" name="entryFee" placeholder="e.g., Free, 5,000 Gold, or None">

            <label for="guildId">Target Discord Server</label>
            <select id="guildId" name="guildId" required ${formDisabled}>
                ${guildOptions}
            </select>
            
            <label for="channelId">Target Discord Channel</label>
            <select id="channelId" name="channelId" required disabled>
                <option value="" disabled selected>Select a Server First</option>
            </select>
            
            <button type="submit" ${formDisabled ? 'disabled' : ''}>🚀 Launch Registration Event</button>
        </form>
        <hr style="border-top: 1px solid var(--border-color); margin: 30px 0;">
        <p style="margin-bottom: 0;">Is your server missing? <a href="/discord/invite" style="color: var(--success-color); font-weight: 600;">Invite the bot here</a>.</p>
    `;

    // --- 3. The login content if not logged in ---
    const loginPrompt = `
        <p>You must log in with Discord to manage tournaments and see only your servers.</p>
        <a href="/discord/login" style="text-decoration: none;">
            <button type="button" style="background-color: #5865F2; /* Discord Blurple */">
                🔗 Login with Discord
            </button>
        </a>
        <hr style="border-top: 1px solid var(--border-color); margin: 30px 0;">
        <p style="margin-bottom: 0;">Is your server missing? <a href="/discord/invite" style="color: var(--success-color); font-weight: 600;">Invite the bot here</a>.</p>
    `;
    
    // --- 4. Determine content to display ---
    let contentToDisplay;
    if (customContent !== null) {
        contentToDisplay = customContent;
    } else if (filteredGuilds !== null) {
        contentToDisplay = setupForm;
    } else {
        contentToDisplay = loginPrompt;
    }


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

            /* Guild List Specific Styles */
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
                background-color: #22c55e;
            }
            .guild-name {
                font-weight: 600;
            }

            /* Message Styling */
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
            // Client-side logic for dynamic Channel selection
            document.addEventListener('DOMContentLoaded', () => {
                const guildSelect = document.getElementById('guildId');
                const channelSelect = document.getElementById('channelId');
                
                if (!guildSelect || !channelSelect) return;

                // 1. Event listener for when a Server is selected
                guildSelect.addEventListener('change', async (e) => {
                    const guildId = e.target.value;
                    channelSelect.innerHTML = '<option value="" disabled selected>Loading Channels...</option>';
                    channelSelect.disabled = true;

                    if (!guildId) return;

                    try {
                        // Use the new API endpoint to fetch channels for the selected guild
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
 * Generates the HTML to list invitable guilds (Only used for the explicit /invite route).
 * [Invite logic remains mostly unchanged]
 */
function getGuildListHtml(guilds) {
    // Filter for guilds where the user has Administrator permissions (BigInt 0x8)
    const invitableGuilds = guilds.filter(guild => {
        const permission = BigInt(guild.permissions);
        const administrator = BigInt(0x8);
        return (permission & administrator) === administrator;
    });

    if (invitableGuilds.length === 0) {
        return `
            <div class="message-box error">
                <h2>No Servers Found</h2>
                <p>You do not have Administrator permissions in any server to invite the bot.</p>
            </div>
            <a href="/" style="text-decoration: none;"><button>Return to Login</button></a>
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
            <h2>Invite Bot</h2>
            <p>Select a server where you have admin rights to invite the bot:</p>
        </div>
        <ul class="guild-list">
            ${guildItems}
        </ul>
        <hr style="border-top: 1px solid var(--border-color); margin: 30px 0;">
        <a href="/" style="text-decoration: none;"><button>Return to Tournament Manager</button></a>
    `;
}

// --- EXPRESS SERVER (WEB APP ROUTES) ---
app.use(bodyParser.urlencoded({ extended: true }));

// GET route: Default route now enforces login
app.get('/', (req, res) => {
    if (client.isReady()) {
        // If no user information is available, show the login prompt (filteredGuilds = null)
        res.send(getWebpageHtml(null));
    } else {
        res.status(503).send('<body style="background: var(--bg-color); color: var(--text-color); font-family: \'Inter\', sans-serif;">Bot not ready. Please wait a moment and refresh.</body>');
    }
});

// Explicit invite link (requires login, but uses a different redirect)
app.get('/discord/invite', (req, res) => {
    if (!CLIENT_ID) {
        return res.status(500).send('<body style="background: black; color: white;">CLIENT_ID not set.</body>');
    }
    const url = `${DISCORD_API_BASE}/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(`${PUBLIC_URL}/discord/callback-invite`)}&scope=${encodeURIComponent(SCOPES)}`;
    res.redirect(url);
});

// Route 1: Redirects user to Discord's authorization page (Standard login for management form)
app.get('/discord/login', (req, res) => {
    if (!CLIENT_ID) {
        return res.status(500).send('<body style="background: black; color: white;">CLIENT_ID not set. Cannot proceed with OAuth.</body>');
    }
    // Uses the standard REDIRECT_URI to return to the server-side logic
    const url = `${DISCORD_API_BASE}/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;
    res.redirect(url);
});


// API Endpoint: Get text channels for a specific guild (This remains accessible)
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

        const channels = await guild.channels.fetch();
        // Filter for text channels (ChannelType.GuildText is 0)
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

// Route 2A: Receives the authorization code and exchanges it for an access token (for the main form)
app.get('/discord/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
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
                redirect_uri: REDIRECT_URI, // Uses the dynamic REDIRECT_URI
                scope: SCOPES,
            }),
        });

        const tokenData = await tokenResponse.json();
        const { access_token } = tokenData;

        if (!access_token) {
            throw new Error('Failed to obtain access token.');
        }

        // Use token to get user's guilds
        const userGuildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });

        const userGuilds = await userGuildsResponse.json();

        if (!Array.isArray(userGuilds)) {
            throw new Error('Failed to retrieve user guilds.');
        }

        // --- FILTERING LOGIC: Find intersection of User's guilds and Bot's guilds ---
        const botGuildIds = client.guilds.cache.map(guild => guild.id);
        
        const filteredGuilds = userGuilds
            .filter(userGuild => botGuildIds.includes(userGuild.id))
            .map(g => ({ id: g.id, name: g.name })); // Keep only necessary data

        // Render the main page, passing the filtered list directly
        res.send(getWebpageHtml(filteredGuilds));

    } catch (error) {
        console.error('OAuth Flow Error (Management):', error);
        res.status(500).send(getWebpageHtml(null)); // Redirect back to login prompt on error
    }
});


// Route 2B: Receives the authorization code and exchanges it for an access token (for the invite flow)
// FIX: The rendering logic now correctly uses the customContent parameter in getWebpageHtml.
app.get('/discord/callback-invite', async (req, res) => {
    const { code } = req.query;

    if (!code) {
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
                // IMPORTANT: This URI must be registered in the Discord Developer Portal
                redirect_uri: `${PUBLIC_URL}/discord/callback-invite`, 
                scope: SCOPES,
            }),
        });

        const tokenData = await tokenResponse.json();
        const { access_token } = tokenData;

        if (!access_token) {
            throw new Error('Failed to obtain access token.');
        }

        // Use token to get user's guilds
        const guildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });

        const guilds = await guildsResponse.json();

        if (!Array.isArray(guilds)) {
            throw new Error('Failed to retrieve user guilds.');
        }

        // Render the list of invitable guilds using the new custom content parameter
        res.send(getWebpageHtml(null, getGuildListHtml(guilds)));

    } catch (error) {
        console.error('OAuth Flow Error (Invite):', error);
        // If the error is an OAuth error, it often means the redirect URI is bad.
        res.status(500).send(`
            <body style="background: var(--bg-color); color: var(--text-color); font-family: 'Inter', sans-serif;">
                <div class="card-container" style="max-width: 500px; margin: auto; padding: 2rem; background: #1f1f1f; border-radius: 0.5rem; color: #f3f4f6; text-align: center;">
                    <h2>OAuth Error</h2>
                    <p>There was an error logging you in. This usually means the **redirect URI** in the Discord Developer Portal is incorrect or missing the path: <strong>/discord/callback-invite</strong>.</p>
                    <a href="/" style="color: #4ade80; text-decoration: none; font-weight: 600;">Return to Login</a>
                </div>
            </body>
        `);
    }
});


// POST route: Handles the form submission to start the tournament
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

    const { name, prize, guildId, channelId, entryFee } = req.body;
    
    if (!name || !prize || !guildId || !channelId) {
        return res.status(400).send('<body style="background: black; color: white;">Missing required details.</body>');
    }
    
    let htmlResponse;
    try {
        const channel = await client.channels.fetch(channelId);
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
            .setColor(0x6366f1); 

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
                <a href="/">Go Back to Manager</a>
            </div>
        `;

    } catch (error) {
        console.error('Error starting tournament:', error);
        htmlResponse = `
            <div class="message-box error">
                <h2>Error</h2>
                <p>Could not start tournament.</p>
                <p>Details: ${error.message}</p>
                <a href="/">Go Back to Manager</a>
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
