require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client: SelfBotClient } = require('discord.js-selfbot-v13');
const { Client: BotPrincipalClient, GatewayIntentBits } = require('discord.js');
const QRCode = require('qrcode');
const { AttachmentBuilder } = require('discord.js-selfbot-v13');

// ===== CONFIGURAÇÕES =====
const PREFIX = process.env.PREFIX || '!';
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

// ===== SERVIDOR WEB =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Bot Pix Online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

// ===== BANCO DE DADOS SIMPLES =====
const dbPath = path.join('/tmp', 'users.json');

let usuarios = [];
try {
    if (fs.existsSync(dbPath)) {
        usuarios = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        console.log(`📂 Banco carregado: ${usuarios.length} usuários`);
    } else {
        fs.writeFileSync(dbPath, JSON.stringify([]));
        console.log('📂 Novo banco criado');
    }
} catch (e) {
    console.log('Erro ao ler banco:', e);
    usuarios = [];
}

function salvarUsuarios() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(usuarios, null, 2));
    } catch (e) {
        console.log('Erro ao salvar:', e);
    }
}

// ===== SELF-BOTS ATIVOS =====
const selfBotsAtivos = new Map();

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX =====
function gerarPayloadPix(chave) {
    const chaveLimpa = chave.replace(/\D/g, '');
    return `0002010014br.gov.bcb.pix01${chaveLimpa.length.toString().padStart(2, '0')}${chaveLimpa}5204000053039865802BR5913DiscordBot6008BRASILIA6304A1B2`;
}

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);
        
        const client = new SelfBotClient({ checkUpdate: false });

        client.on('ready', () => {
            console.log(`✅✅✅ SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();
            
            selfBotsAtivos.set(usuario.userId, {
                client,
                tag: client.user.tag
            });
        });

        // VERSÃO SIMPLIFICADA - APENAS O NECESSÁRIO
        client.on('messageCreate', async (message) => {
            try {
                // Ignorar próprias mensagens
                if (message.author.id === client.user.id) return;
                
                // Log simples
                console.log(`📨 [${client.user.tag}] ${message.content}`);
                
                // Verificar se é comando
                if (!message.content.startsWith(PREFIX)) return;
                
                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                
                // COMANDO TESTE
                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando!**');
                    console.log(`  ✅ Teste respondido`);
                }
                
                // COMANDO PING
                if (command === 'ping') {
                    await message.reply('🏓 **Pong!**');
                }
                
                // COMANDO PIX
                if (command === 'pix') {
                    if (!args[0]) {
                        await message.reply('❌ Use: !pix [chave]');
                        return;
                    }
                    
                    const chave = args[0];
                    const procMsg = await message.reply('🔄 Gerando QR Code...');
                    
                    try {
                        const payload = gerarPayloadPix(chave);
                        const qrBuffer = await QRCode.toBuffer(payload);
                        const attachment = new AttachmentBuilder(qrBuffer, { name: 'pix.png' });
                        
                        await message.reply({
                            content: `✅ QR Code para: \`${chave}\``,
                            files: [attachment]
                        });
                        
                        await procMsg.delete();
                        console.log(`  ✅ Pix gerado para ${chave}`);
                        
                    } catch (err) {
                        console.error('Erro:', err);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code');
                    }
                }
                
            } catch (err) {
                console.error('Erro no self-bot:', err);
            }
        });

        await client.login(usuario.userToken);
        return true;

    } catch (error) {
        console.error(`❌ Erro ao iniciar self-bot:`, error.message);
        usuario.status = 'offline';
        salvarUsuarios();
        return false;
    }
}

// ===== INICIAR TODOS OS SELF-BOTS =====
function iniciarTodosSelfBots() {
    console.log(`🔄 Iniciando ${usuarios.length} self-bots...`);
    for (const usuario of usuarios) {
        if (usuario.status === 'active') {
            setTimeout(() => iniciarSelfBot(usuario), 2000);
        }
    }
}

// ===== BOT PRINCIPAL =====
const botPrincipal = new BotPrincipalClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

botPrincipal.once('ready', () => {
    console.log(`✅ Bot Principal: ${botPrincipal.user.tag}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === ADMIN_ID;

    if (command === 'ping') {
        return message.reply('🏓 Pong!');
    }

    if (!isAdmin) return;

    if (command === 'status') {
        return message.reply(
            `📊 **STATUS**\n` +
            `Usuários: ${usuarios.length}\n` +
            `Online: ${selfBotsAtivos.size}`
        );
    }

    if (command === 'listar') {
        let lista = '📋 **USUÁRIOS**\n';
        for (const u of usuarios) {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} ${u.discordTag || u.userId}\n`;
        }
        return message.reply(lista || 'Nenhum usuário');
    }

    if (command === 'registrar') {
        if (args.length < 2) {
            return message.reply('❌ Use: !registrar [ID] [token]');
        }

        const userId = args[0];
        const userToken = args[1];

        try {
            // Testar token
            const testClient = new SelfBotClient({ checkUpdate: false });
            await testClient.login(userToken);
            const userTag = testClient.user.tag;
            await testClient.destroy();

            const novoUsuario = {
                userId,
                discordTag: userTag,
                userToken,
                status: 'active'
            };

            usuarios.push(novoUsuario);
            salvarUsuarios();

            const iniciou = await iniciarSelfBot(novoUsuario);

            await message.reply(
                `✅ Usuário **${userTag}** registrado!\n` +
                `Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}`
            );

        } catch (err) {
            await message.reply(`❌ Erro: ${err.message}`);
        }
    }
});

// ===== INICIAR =====
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN não configurado!');
    process.exit(1);
}

botPrincipal.login(BOT_TOKEN).catch(err => {
    console.error('❌ Erro no login:', err);
    process.exit(1);
});