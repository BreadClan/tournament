// index.js - Complete Tournament Bot Application for Cloud Hosting (Render/Vercel/etc.)

// --- Imports ---
const { 
    Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, 
    PermissionsBitField, ChannelType
} = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
const { createCanvas } = require('@napi-rs/canvas'); 
const fetch = require('node-fetch'); // Required for Discord API calls

// --- Configuration & Initialization ---

// Read environment variables (MUST be set in your hosting environment)
const TOKEN = process.env.DISCORD_TOKEN; 
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET; // REQUIRED for OAuth
const REDIRECT_URI = process.env.REDIRECT_URI; // REQUIRED, e.g., https://your-app-url.com/auth/discord/callback

const PORT = process.env.PORT || 3000; 

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
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Global state for the single active tournament
const tournamentState = {
    isActive: false,
    channelId: null,
    messageId: null,
    // Participants stored as { id: 'userID', username: 'username' }
    participants: [], 
    details: {},
    // bracket structure: { matchId: number, p1: string, p2: string, winner: string | null }
    bracket: [] 
};

// --- UTILITY FUNCTIONS ---

/**
 * Filters the guilds a user is in to only show those where the bot is also present 
 * and the user has Administrator permissions (MANAGE_GUILD is enough for this check).
 * @param {Array<Object>} userGuilds - Guilds fetched from the Discord API.
 * @param {Client} botClient - The Discord bot client.
 * @returns {Array<Object>} Filtered list of manageable guilds.
 */
function getBotGuilds(userGuilds, botClient) {
    if (!botClient.isReady()) return [];
    
    const botGuildIds = botClient.guilds.cache.map(guild => guild.id);
    
    // Check for ADMINISTRATOR permission (Bit 3: 0x8)
    const ADMIN_PERMISSION_BIT = 0x8; 

    return userGuilds.filter(guild => 
        botGuildIds.includes(guild.id) && 
        (Number(guild.permissions) & ADMIN_PERMISSION_BIT) === ADMIN_PERMISSION_BIT
    );
}

/**
 * Generates initial pairings for a single-elimination tournament.
 * Pads with 'BYE' if player count is not a power of 2.
 * @param {Array<{id: string, username: string}>} players 
 * @returns {Array<{p1: string, p2: string, matchId: number, winner: string | null}>}
 */
function generatePairings(players) {
    if (!players || players.length < 2) {
        return [];
    }
    
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
        const p1 = shuffledPlayers[i];
        const p2 = shuffledPlayers[shuffledPlayers.length - 1 - i];
        
        let winner = null;
        if (p1.username === 'BYE') {
            winner = p2.username;
        } else if (p2.username === 'BYE') {
            winner = p1.username;
        }

        pairings.push({
            matchId: i + 1,
            p1: p1.username,
            p2: p2.username,
            winner: winner
        });
    }
    
    return pairings;
}

/**
 * Draws the tournament bracket using the canvas library. 
 * Renders a clean single-round bracket image.
 * @param {Array<Object>} pairings - The current round's match list.
 * @returns {Buffer} PNG image buffer.
 */
async function drawTournamentBracket(pairings) {
    const MATCH_COUNT = pairings.length;
    // Base dimensions and spacing
    const BOX_WIDTH = 250;
    const BOX_HEIGHT = 40;
    const SPACING = 20;
    const MARGIN = 30;
    const TEXT_SIZE = 18;

    const requiredHeight = MATCH_COUNT * (BOX_HEIGHT * 2 + SPACING) + MARGIN * 2;
    const requiredWidth = BOX_WIDTH * 2 + MARGIN * 2 + 50; 
    
    const canvas = createCanvas(requiredWidth, Math.max(200, requiredHeight));
    const ctx = canvas.getContext('2d');
    
    const LINE_COLOR = '#4f46e5'; // Indigo
    const TEXT_COLOR = '#f3f4f6';
    const WINNER_COLOR = '#4ade80'; // Green

    ctx.fillStyle = '#111827'; 
    ctx.fillRect(0, 0, requiredWidth, requiredHeight);
    
    ctx.font = `600 ${TEXT_SIZE}px Inter, sans-serif`;
    ctx.textAlign = 'left';

    let currentY = MARGIN;

    // Draw Matches
    pairings.forEach(match => {
        const y = currentY;
        const x = MARGIN;
        
        // --- Draw Match Box Outline ---
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = 3;
        // Use rect and strokeRect to draw two boxes connected by a line
        ctx.strokeRect(x, y, BOX_WIDTH, BOX_HEIGHT * 2);

        // --- Separator Line ---
        ctx.beginPath();
        ctx.moveTo(x, y + BOX_HEIGHT);
        ctx.lineTo(x + BOX_WIDTH, y + BOX_HEIGHT);
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // --- Player 1 Name ---
        ctx.fillStyle = match.winner === match.p1 ? WINNER_COLOR : TEXT_COLOR;
        ctx.fillText(match.p1, x + 10, y + BOX_HEIGHT * 0.5 + TEXT_SIZE / 2 - 5);
        
        // --- Player 2 Name ---
        ctx.fillStyle = match.winner === match.p2 ? WINNER_COLOR : TEXT_COLOR;
        ctx.fillText(match.p2, x + 10, y + BOX_HEIGHT * 1.5 + TEXT_SIZE / 2 - 5);

        // --- Connection Line to Winner Spot ---
        const midY = y + BOX_HEIGHT;
        ctx.beginPath();
        ctx.moveTo(x + BOX_WIDTH, midY);
        ctx.lineTo(x + BOX_WIDTH + 50, midY); 
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = 3;
        ctx.stroke();

        // --- Winner Text Placeholder/Actual Winner ---
        ctx.font = `500 ${TEXT_SIZE}px Inter, sans-serif`;
        const winnerTextX = x + BOX_WIDTH + 60;
        
        if (match.winner) {
            ctx.fillStyle = WINNER_COLOR;
            ctx.fillText(`> ${match.winner.toUpperCase()}`, winnerTextX, midY + TEXT_SIZE / 2 - 5);
        } else {
             ctx.fillStyle = '#a1a1aa'; // Gray
             ctx.fillText('PENDING', winnerTextX, midY + TEXT_SIZE / 2 - 5);
        }

        currentY += (BOX_HEIGHT * 2 + SPACING);
        ctx.fillStyle = TEXT_COLOR; 
    });

    return canvas.toBuffer('image/png');
}


/**
 * Updates the Discord message with the latest participants and bracket image.
 */
async function updateTournamentPost() {
    if (!tournamentState.messageId || !tournamentState.channelId) return;

    try {
        const channel = await client.channels.fetch(tournamentState.channelId);
        if (!channel) return;
        const message = await channel.messages.fetch(tournamentState.messageId);

        if (tournamentState.bracket.length === 0 && tournamentState.participants.length > 1 && tournamentState.isActive) {
            tournamentState.bracket = generatePairings(tournamentState.participants);
        }
        
        let finalWinner = null;
        if (!tournamentState.isActive && tournamentState.bracket.length === 1) {
            finalWinner = tournamentState.bracket[0].winner;
        }

        const imageBuffer = await drawTournamentBracket(tournamentState.bracket);
        
        const participantList = tournamentState.participants.length > 0 
            ? tournamentState.participants.map(p => `• ${p.username}`).join('\n') 
            : 'No one has joined yet.';
        
        const embedTitle = finalWinner 
            ? `👑 CHAMPION: ${finalWinner.toUpperCase()}`
            : `🏆 ${tournamentState.details.name}`;

        const embedDescription = tournamentState.isActive 
            ? `React with ✅ below to join! Current Participants:` 
            : `This tournament has concluded. Congratulations to **${finalWinner}**!`;

        const newEmbed = new EmbedBuilder()
            .setTitle(embedTitle)
            .setDescription(embedDescription)
            .addFields(
                { name: 'Prize', value: tournamentState.details.prize, inline: true },
                { name: 'Entry Fee', value: tournamentState.details.entryFee || 'Free', inline: true },
                { name: `Participants (${tournamentState.participants.length})`, value: participantList.substring(0, 1024), inline: false }
            )
            .setColor(tournamentState.isActive ? 0x6366f1 : 0x4ade80)
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

// --- EXPRESS SERVER (WEB APP ROUTES) ---

// 1. Initial Login Page
app.get('/', (req, res) => {
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=identify%20guilds`;
    
    // Simple HTML response for the root page
    const activeStatus = tournamentState.isActive ? 'block' : 'none';
    const launchDisplay = tournamentState.isActive ? 'none' : 'block';

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tournament Bot Manager</title>
        <style>
            /* Basic styling for the web manager */
            :root {
                --bg-color: #0c0c0c;
                --card-color: #1f1f1f;
                --text-color: #f3f4f6;
                --accent-color: #6366f1; 
                --error-color: #ef4444; 
            }
            body {
                background-color: var(--bg-color);
                color: var(--text-color);
                font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
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
                box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
                text-align: center;
            }
            h1 { font-size: 1.875rem; margin-bottom: 0.5rem; }
            p.sub { color: #a1a1aa; margin-bottom: 2rem; }
            a.login-button {
                display: inline-block;
                padding: 1rem 2rem;
                background-color: var(--accent-color);
                color: white;
                font-weight: 600;
                border-radius: 0.5rem;
                text-decoration: none;
                transition: background-color 0.2s;
                font-size: 1.125rem;
            }
            a.login-button:hover { background-color: #4f46e5; }
            .message-box {
                padding: 1.5rem;
                border-radius: 0.5rem;
                margin-bottom: 20px;
                text-align: center;
                background-color: rgba(239, 68, 68, 0.1);
                border: 1px solid var(--error-color);
                color: var(--error-color);
                display: ${activeStatus};
            }
            .login-section { display: ${launchDisplay}; }
        </style>
    </head>
    <body>
        <div class="card-container">
            <h1>Tournament Bot Manager 🏆</h1>
            <p class="sub">Log in with Discord to select a server and launch your tournament registration event.</p>
            
            <div class="message-box">
                <h2>Tournament Active!</h2>
                <p>A tournament is currently active. Please use the **/endtournament** command in Discord to launch a new one.</p>
            </div>

            <div class="login-section">
                <a href="${authUrl}" class="login-button">Login with Discord</a>
            </div>
        </div>
    </body>
    </html>
    `);
});

// 2. OAuth Callback Handler
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    const errorPage = (msg) => `<body style="background: #0c0c0c; color: #f3f4f6; font-family: 'Inter', sans-serif; text-align: center; padding-top: 50px;"><div style="background: #1f1f1f; padding: 2rem; border-radius: 0.5rem; border: 1px solid #ef4444;"><h2>Error!</h2><p>${msg}</p><a href="/" style="color: #4ade80;">Go Back</a></div></body>`;
    
    if (tournamentState.isActive) {
        return res.status(400).send(errorPage('A tournament is already active. Please end it first in Discord.'));
    }

    if (!code) {
        return res.redirect('/');
    }

    try {
        // Step 1: Exchange code for token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI,
                scope: 'identify guilds'
            }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) throw new Error(tokenData.error_description || 'Failed to retrieve access token.');

        // Step 2: Fetch User's Guilds
        const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userGuilds = await guildsResponse.json();

        if (!Array.isArray(userGuilds)) throw new Error('Failed to fetch user guilds.');

        // Step 3: Filter Guilds
        const manageableGuilds = getBotGuilds(userGuilds, client);
        
        if (manageableGuilds.length === 0) {
            const inviteLink = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&integration_type=0&scope=bot+applications.commands`;
            return res.status(403).send(errorPage(`We couldn't find any servers where you have Administrator permissions and the bot is invited. Please **<a href="${inviteLink}" style="color: #4ade80;">invite the bot here</a>**.`));
        }

        // Step 4: Display Server/Channel Selection Form
        const guildOptions = manageableGuilds.map(guild => 
            `<option value="${guild.id}">${guild.name}</option>`
        ).join('');
        
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Launch Tournament</title>
            <style>
                :root {
                    --bg-color: #0c0c0c;
                    --card-color: #1f1f1f;
                    --text-color: #f3f4f6;
                    --input-bg: #2d2d2d;
                    --border-color: #3f3f3f;
                    --accent-color: #6366f1; 
                }
                body {
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    font-family: 'Inter', sans-serif;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .card-container { max-width: 500px; width: 100%; background-color: var(--card-color); padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5); }
                h1 { font-size: 1.875rem; font-weight: 700; margin-bottom: 0.5rem; text-align: center; }
                p.sub { color: #a1a1aa; margin-bottom: 2rem; text-align: center; }
                label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; }
                input[type="text"], select { width: 100%; padding: 0.75rem 1rem; margin-bottom: 1.5rem; background-color: var(--input-bg); border: 1px solid var(--border-color); border-radius: 0.5rem; color: var(--text-color); box-sizing: border-box; }
                button { width: 100%; padding: 0.75rem; background-color: var(--accent-color); color: white; font-weight: 600; border: none; border-radius: 0.5rem; cursor: pointer; transition: background-color 0.2s; font-size: 1rem; margin-top: 10px; }
                button:hover { background-color: #4f46e5; }
                .info-block { background: var(--input-bg); padding: 1rem; border-radius: 0.5rem; margin-bottom: 2rem; font-size: 0.875rem; color: #a1a1aa; text-align: left; }
                .info-block strong { color: var(--text-color); }
            </style>
        </head>
        <body>
            <div class="card-container">
                <h1>Launch Event Details</h1>
                <p class="sub">Select a server and configure your tournament event.</p>

                <form action="/start-tournament" method="POST">
                    <label for="guildId">Select Discord Server</label>
                    <select id="guildId" name="guildId" required>
                        ${guildOptions}
                    </select>
                    
                    <label for="name">Tournament Name</label>
                    <input type="text" id="name" name="name" placeholder="e.g., Spring Smash 2024" required>
                    
                    <label for="prize">Prize Details</label>
                    <input type="text" id="prize" name="prize" placeholder="e.g., $50 Nitro, Custom Role" required>
                    
                    <label for="entryFee">Entry Fee (Optional)</label>
                    <input type="text" id="entryFee" name="entryFee" placeholder="e.g., Free, 5,000 Gold, or None">

                    <div class="info-block">
                        <strong>Channel ID:</strong> Enable **Developer Mode** in Discord, right-click the text channel where you want the post, and select **Copy Channel ID**.
                    </div>
                    <label for="channelId">Target Discord Channel ID</label>
                    <input type="text" id="channelId" name="channelId" placeholder="e.g., 876543210987654321" required pattern="[0-9]+" title="Must be a numerical Discord ID">
                    
                    <button type="submit">🚀 Launch Registration Event</button>
                </form>
            </div>
        </body>
        </html>
        `);

    } catch (error) {
        console.error('Discord OAuth Error:', error);
        res.status(500).send(errorPage(`There was an OAuth error: ${error.message}`));
    }
});

// 3. POST route: Handles the form submission to start the tournament
app.post('/start-tournament', async (req, res) => {
    if (tournamentState.isActive) {
        return res.status(400).send(`
            <body style="background: #0c0c0c; color: #f3f4f6; font-family: 'Inter', sans-serif; text-align: center; padding-top: 50px;">
                <div style="background: #1f1f1f; padding: 2rem; border-radius: 0.5rem; border: 1px solid #ef4444;">
                    <h2>Error!</h2>
                    <p>A tournament is already active. Please use the **/endtournament** command in Discord first.</p>
                    <a href="/" style="color: #4ade80;">Go Back</a>
                </div>
            </body>
        `);
    }

    const { name, prize, guildId, channelId, entryFee } = req.body;
    
    let htmlResponse;
    try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) {
             throw new Error('Invalid Guild ID or the bot is not in that server.');
        }

        const channel = await guild.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) { 
            throw new Error('Invalid Channel ID or channel is not a text channel.');
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

        // Send with an initial blank bracket image
        const message = await channel.send({ 
            embeds: [initialEmbed],
            files: [{ 
                attachment: await drawTournamentBracket([]), 
                name: 'tournament-bracket.png' 
            }]
        });
        await message.react('✅'); 
        
        tournamentState.messageId = message.id;

        htmlResponse = `
            <div class="message-box success" style="border: 1px solid #4ade80; background-color: rgba(74, 222, 128, 0.1); color: #4ade80; padding: 1.5rem; border-radius: 0.5rem; text-align: center;">
                <h2>Success!</h2>
                <p>Tournament **${name}** launched in Discord server **${guild.name}**, channel **#${channel.name}**.</p>
                <p>Registrations are open. Use Discord commands for management.</p>
                <a href="/" style="color: #4ade80; text-decoration: none; font-weight: 600;">Go Back to Manager</a>
            </div>
        `;

    } catch (error) {
        console.error('Error starting tournament:', error);
        htmlResponse = `
            <div class="message-box error" style="border: 1px solid #ef4444; background-color: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 1.5rem; border-radius: 0.5rem; text-align: center;">
                <h2>Error</h2>
                <p>Could not start tournament. Please verify the server and channel details.</p>
                <p>Details: ${error.message}</p>
                <a href="/" style="color: #4ade80; text-decoration: none; font-weight: 600;">Go Back to Login</a>
            </div>
        `;
    }
    
    res.send(`
        <body style="background: #0c0c0c; color: #f3f4f6; font-family: 'Inter', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px;">
            <div class="card-container" style="max-width: 500px; width: 100%; background-color: #1f1f1f; padding: 2.5rem; border-radius: 1rem; border: 1px solid #3f3f3f; box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);">
                ${htmlResponse}
            </div>
        </body>
    `);
});


// --- DISCORD BOT LOGIC ---

client.on('ready', () => {
    console.log(`Bot is logged in as ${client.user.tag}!`);
    
    // Define and Register Slash Commands
    const updateWinnerCommand = new SlashCommandBuilder()
        .setName('updatewinner')
        .setDescription('Advances the specified user to the next round of the active tournament.')
        .addUserOption(option => 
            option.setName('winner')
                .setDescription('The user who won the match to be advanced.')
                .setRequired(true));

    const endTournamentCommand = new SlashCommandBuilder()
        .setName('endtournament')
        .setDescription('Ends the current active tournament immediately (Admin only).');

    // Register commands globally
    client.application.commands.set([
        updateWinnerCommand.toJSON(),
        endTournamentCommand.toJSON()
    ]);
});

// Handler for the Reaction Sign-up
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || reaction.message.id !== tournamentState.messageId || reaction.emoji.name !== '✅' || !tournamentState.isActive) return;

    try {
        if (!tournamentState.participants.some(p => p.id === user.id)) {
            const fetchedUser = await client.users.fetch(user.id);
            tournamentState.participants.push({ id: fetchedUser.id, username: fetchedUser.username });
            console.log(`${fetchedUser.username} joined the tournament.`);
            
            if (tournamentState.participants.length >= 2 && tournamentState.bracket.length === 0) {
                 tournamentState.bracket = generatePairings(tournamentState.participants);
            }

            await updateTournamentPost();
        }
    } catch (e) {
        console.error("Error processing reaction:", e);
    }
});

// Handler for Slash Commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- Permissions Check (for management commands) ---
    const memberPermissions = interaction.member?.permissions;
    const isAdmin = memberPermissions && memberPermissions.has(PermissionsBitField.Flags.Administrator);

    if (interaction.commandName === 'endtournament') {
        if (!isAdmin) {
            return interaction.reply({ content: 'You need Administrator permission to end the tournament.', ephemeral: true });
        }

        if (!tournamentState.isActive) {
            return interaction.reply({ content: 'There is no active tournament to end.', ephemeral: true });
        }
        
        const oldName = tournamentState.details.name;
        // Reset state
        tournamentState.isActive = false;
        tournamentState.channelId = null;
        tournamentState.messageId = null;
        tournamentState.participants = [];
        tournamentState.details = {};
        tournamentState.bracket = [];

        await updateTournamentPost(); 

        return interaction.reply({ content: `✅ The tournament **${oldName}** has been successfully ended and all state has been reset.`, ephemeral: false });
    }

    if (interaction.commandName === 'updatewinner') {
        if (!isAdmin || !tournamentState.isActive || tournamentState.participants.length < 2 || tournamentState.bracket.length === 0) {
            return interaction.reply({ content: 'Admin permissions are required, and the tournament must be active with pairings started.', ephemeral: true });
        }
        
        const winner = interaction.options.getUser('winner');
        const winnerUsername = winner.username;
        
        let matchFound = false;

        // Find the match the winner was in and update it
        for (const match of tournamentState.bracket) {
            if (!match.winner && (match.p1 === winnerUsername || match.p2 === winnerUsername)) {
                match.winner = winnerUsername;
                matchFound = true;
                
                let opponent = match.p1 === winnerUsername ? match.p2 : match.p1;
                
                await interaction.reply({ content: `**${winnerUsername}** has won against **${opponent}** and advanced!`, ephemeral: true });
                break;
            }
        }

        if (!matchFound) {
            return interaction.reply({ content: `Could not find an active match for **${winnerUsername}**. They might have already won, or the match is completed.`, ephemeral: true });
        }
        
        // Check if the entire round is complete
        const allComplete = tournamentState.bracket.every(m => m.winner !== null);

        if (allComplete) {
            const roundWinners = tournamentState.bracket.map(m => m.winner).filter(w => w !== 'BYE');
            
            if (roundWinners.length === 1) {
                 // Final winner!
                 const finalWinner = roundWinners[0];
                 await interaction.followUp({ content: `🎉 **${finalWinner}** has won the entire tournament **${tournamentState.details.name}**! Congratulations!`, ephemeral: false });
                 
                 // Mark tournament inactive and update final bracket
                 tournamentState.isActive = false;
                 tournamentState.bracket = [{ matchId: 1, p1: finalWinner, p2: 'CHAMPION', winner: finalWinner }]; 

            } else if (roundWinners.length > 1) {
                // Start the next round
                const nextRoundPlayers = roundWinners.map(username => ({ 
                    id: tournamentState.participants.find(p => p.username === username)?.id || 'UNKNOWN', 
                    username: username 
                }));
                
                tournamentState.bracket = generatePairings(nextRoundPlayers);
                await interaction.followUp({ content: `🏆 Round complete! Starting the next round with ${tournamentState.bracket.length} matches. Check the updated bracket in the announcement channel.`, ephemeral: false });
            }
        }
        
        await updateTournamentPost(); 
    }
});

// --- Start Services ---
client.login(TOKEN);
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));
