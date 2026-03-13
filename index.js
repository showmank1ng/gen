require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ===== SERVIDOR WEB (para Render) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Bot Pix está online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

// ===== CONFIGURAÇÕES =====
const PREFIX = process.env.PREFIX || '!';
const ADMIN_ID = process.env.ADMIN_ID;
const MAIN_BOT_TOKEN = process.env.MAIN_BOT_TOKEN;

// ===== BANCO DE DADOS SIMPLES =====
const dbPath = path.join('/tmp', 'users.json');

// Carregar ou criar banco
let users = [];
try {
    if (fs.existsSync(dbPath)) {
        users = JSON.parse(fs.readFileSync(dbPath, 'utf8')).users || [];
    } else {
        fs.writeFileSync(dbPath, JSON.stringify({ users: [] }));
    }
} catch (e) {
    console.log('Erro ao ler banco:', e);
}

// Salvar banco
function saveUsers() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify({ users }, null, 2));
    } catch (e) {
        console.log('Erro ao salvar:', e);
    }
}

// ===== CLIENTE PRINCIPAL =====
const mainClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// ===== ARMAZENAR SELF-BOTS =====
const activeSelfBots = new Map();

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function startSelfBot(userData) {
    try {
        console.log(`🔄 Iniciando self-bot para ${userData.discordTag}...`);
        
        // Importar self-bot
        const { Client: SelfBotClient } = require('discord.js-selfbot-v13');
        
        const selfBot = new SelfBotClient({ checkUpdate: false });

        selfBot.once('ready', () => {
            console.log(`✅ Self-bot online: ${selfBot.user.tag}`);
            activeSelfBots.set(userData.userId, {
                client: selfBot,
                tag: selfBot.user.tag
            });
        });

        // PROCESSAR COMANDOS NO SELF-BOT
        selfBot.on('messageCreate', async (msg) => {
            try {
                // Ignorar próprias mensagens
                if (msg.author.id === selfBot.user.id) return;
                
                // Verificar prefixo
                if (!msg.content.startsWith(PREFIX)) return;

                const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                // COMANDO PIX
                if (command === 'pix') {
                    console.log(`📱 Pix command de ${msg.author.tag}`);
                    
                    if (args.length === 0) {
                        return msg.reply(
                            '❌ Use: `!pix [chave]`\n' +
                            'Ex: `!pix 11999999999`'
                        );
                    }

                    const chave = args[0];
                    
                    // Mensagem de processamento
                    const procMsg = await msg.reply('🔄 Gerando QR Code...');

                    try {
                        // Gerar QR Code
                        const QRCode = require('qrcode');
                        const { AttachmentBuilder } = require('discord.js-selfbot-v13');
                        
                        // Payload simples
                        const chaveLimpa = chave.replace(/\D/g, '');
                        const payload = `0002010014br.gov.bcb.pix01${chaveLimpa.length.toString().padStart(2, '0')}${chaveLimpa}5204000053039865802BR5913DiscordBot6008BRASILIA6304A1B2`;
                        
                        const qrBuffer = await QRCode.toBuffer(payload);
                        const attachment = new AttachmentBuilder(qrBuffer, { name: 'pix.png' });

                        await msg.reply({
                            content: `✅ QR Code para: \`${chave}\``,
                            files: [attachment]
                        });
                        
                        await procMsg.delete();
                        
                    } catch (err) {
                        console.error('Erro QR:', err);
                        await procMsg.delete();
                        await msg.reply('❌ Erro ao gerar QR Code');
                    }
                }
                
            } catch (err) {
                console.error('Erro no self-bot:', err);
            }
        });

        await selfBot.login(userData.userToken);
        return true;
        
    } catch (err) {
        console.error('Erro ao iniciar self-bot:', err.message);
        return false;
    }
}

// ===== BOT PRINCIPAL =====
mainClient.once('ready', () => {
    console.log(`✅ Bot principal: ${mainClient.user.tag}`);
    
    // Iniciar self-bots existentes
    users.forEach(user => {
        if (user.status === 'active') {
            setTimeout(() => startSelfBot(user), 1000);
        }
    });
});

// COMANDOS DO BOT PRINCIPAL
mainClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // !ping
    if (command === 'ping') {
        return message.reply('🏓 Pong!');
    }

    // !status
    if (command === 'status') {
        return message.reply(
            `📊 **STATUS**\n` +
            `Bot: 🟢 Online\n` +
            `Usuários: ${users.length}\n` +
            `Self-bots: ${activeSelfBots.size} online`
        );
    }

    // !listar (só admin)
    if (command === 'listar') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Apenas admin');
        }
        
        let lista = '📋 **USUÁRIOS**\n';
        users.forEach(u => {
            const online = activeSelfBots.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} ${u.discordTag}\n`;
        });
        
        return message.reply(lista || 'Nenhum usuário');
    }

    // !registrar (só admin)
    if (command === 'registrar') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Apenas admin');
        }

        if (args.length < 2) {
            return message.reply('❌ Use: `!registrar [ID] [token]`');
        }

        const userId = args[0];
        const userToken = args[1];

        try {
            // Testar token
            const { Client: TestBot } = require('discord.js-selfbot-v13');
            const test = new TestBot({ checkUpdate: false });
            
            await test.login(userToken);
            const userTag = test.user.tag;
            await test.destroy();

            // Salvar
            const newUser = {
                userId,
                discordTag: userTag,
                userToken,
                status: 'active',
                registeredAt: new Date().toISOString()
            };

            users.push(newUser);
            saveUsers();

            // Iniciar self-bot
            await startSelfBot(newUser);

            await message.reply(`✅ Usuário ${userTag} registrado!`);

        } catch (err) {
            console.error('Erro registro:', err);
            await message.reply('❌ Token inválido');
        }
    }
});

// ===== INICIAR BOT =====
if (!MAIN_BOT_TOKEN) {
    console.error('❌ Token não encontrado');
    process.exit(1);
}

mainClient.login(MAIN_BOT_TOKEN).catch(err => {
    console.error('❌ Erro login:', err.message);
    process.exit(1);
});