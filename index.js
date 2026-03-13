require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do servidor web (para manter online)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Pix Multi-Bot está online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

// Cliente principal do Discord (gerenciador)
const mainClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Armazenar clientes ativos
const activeClients = new Map();

// Carregar banco de dados
const usersDbPath = path.join(__dirname, 'database', 'users.json');
fs.ensureDirSync(path.join(__dirname, 'database'));

if (!fs.existsSync(usersDbPath)) {
    fs.writeJsonSync(usersDbPath, { users: [] });
}

// Carregar comandos
mainClient.commands = new Map();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    mainClient.commands.set(command.name, command);
}

// Função para iniciar cliente de usuário
async function startUserClient(userData) {
    try {
        const { Client: SelfBot } = require('discord.js-selfbot-v13');
        const userClient = new SelfBot({ checkUpdate: false });
        
        // Carregar utilitários para o cliente do usuário
        const qrGenerator = require('./utils/qrGenerator');
        
        userClient.on('ready', () => {
            console.log(`✅ Usuário ${userClient.user.tag} está online!`);
            activeClients.set(userData.userId, {
                client: userClient,
                data: userData
            });
        });

        userClient.on('messageCreate', async (message) => {
            if (message.author.id === userClient.user.id) return;
            if (!message.content.startsWith(process.env.PREFIX)) return;

            const args = message.content.slice(process.env.PREFIX.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            // Comandos específicos para o self-bot
            if (commandName === 'pix') {
                try {
                    const result = await qrGenerator.generatePixQR(args);
                    
                    if (result.error) {
                        await message.reply(result.error);
                        return;
                    }

                    await message.reply({
                        content: result.message,
                        files: [result.attachment]
                    });

                    // Atualizar estatísticas
                    updateUserStats(userData.userId);
                    
                } catch (error) {
                    console.error('Erro no comando pix:', error);
                    await message.reply('❌ Erro ao gerar QR Code Pix');
                }
            }
        });

        await userClient.login(userData.userToken);
        return true;
        
    } catch (error) {
        console.error(`Erro ao iniciar cliente para usuário ${userData.userId}:`, error);
        return false;
    }
}

// Função para atualizar estatísticas
function updateUserStats(userId) {
    const db = fs.readJsonSync(usersDbPath);
    const user = db.users.find(u => u.userId === userId);
    if (user) {
        user.commandsUsed = (user.commandsUsed || 0) + 1;
        user.lastUsed = new Date().toISOString();
        fs.writeJsonSync(usersDbPath, db);
    }
}

// Eventos do bot principal
mainClient.once('ready', () => {
    console.log(`🤖 Bot Gerenciador online: ${mainClient.user.tag}`);
    console.log(`📊 Carregando usuários ativos...`);
    
    // Iniciar todos os usuários ativos do banco de dados
    const db = fs.readJsonSync(usersDbPath);
    db.users.forEach(user => {
        if (user.status === 'active') {
            startUserClient(user);
        }
    });
});

mainClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(process.env.PREFIX)) return;

    const args = message.content.slice(process.env.PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    if (!mainClient.commands.has(commandName)) return;

    try {
        const command = mainClient.commands.get(commandName);
        await command.execute(message, args, { mainClient, activeClients, startUserClient, usersDbPath, fs });
    } catch (error) {
        console.error(error);
        await message.reply('❌ Erro ao executar comando');
    }
});

// Login do bot principal
mainClient.login(process.env.MAIN_BOT_TOKEN);