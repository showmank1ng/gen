// VERIFICAÇÃO DE BIBLIOTECAS
console.log('🔍 VERIFICANDO BIBLIOTECAS INSTALADAS...');

try {
    const selfbotVersion = require('discord.js-selfbot-v13/package.json').version;
    console.log(`✅ discord.js-selfbot-v13 versão ${selfbotVersion} instalada!`);
} catch (e) {
    console.error('❌ discord.js-selfbot-v13 NÃO está instalada!');
    console.error('📦 Instale com: npm install discord.js-selfbot-v13@latest');
}

try {
    const qrcodeVersion = require('qrcode/package.json').version;
    console.log(`✅ qrcode versão ${qrcodeVersion} instalada!`);
} catch (e) {
    console.error('❌ qrcode NÃO está instalada!');
}

console.log('📦 Todas as verificações concluídas\n');

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs-extra');
const path = require('path');
const express = require('express');

// ===== SERVIDOR WEB (para Render) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Pix Multi-Bot está online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

// ===== CONFIGURAÇÕES =====
const PREFIX = process.env.PREFIX || '!';
const ADMIN_ID = process.env.ADMIN_ID;
const MAIN_BOT_TOKEN = process.env.MAIN_BOT_TOKEN;

// ===== BANCO DE DADOS (usando /tmp no Render) =====
const dbPath = path.join('/tmp', 'database');
fs.ensureDirSync(dbPath);
const usersDbPath = path.join(dbPath, 'users.json');

if (!fs.existsSync(usersDbPath)) {
    fs.writeJsonSync(usersDbPath, { users: [] });
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

// ===== ARMAZENAR SELF-BOTS ATIVOS =====
const activeSelfBots = new Map();

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function startSelfBot(userData) {
    try {
        console.log(`🔄 Tentando iniciar self-bot para ${userData.discordTag}...`);
        
        // Importar a biblioteca de self-bot
        const { Client: SelfBotClient } = require('discord.js-selfbot-v13');
        
        const selfBot = new SelfBotClient({
            checkUpdate: false,
            readyTimeout: 60000
        });

        // Evento quando o self-bot estiver pronto
        selfBot.once('ready', () => {
            console.log(`✅ Self-bot ONLINE: ${selfBot.user.tag}`);
            
            // Atualizar status no banco
            const db = fs.readJsonSync(usersDbPath);
            const user = db.users.find(u => u.userId === userData.userId);
            if (user) {
                user.status = 'online';
                user.lastOnline = new Date().toISOString();
                fs.writeJsonSync(usersDbPath, db);
            }
            
            // Armazenar no mapa de ativos
            activeSelfBots.set(userData.userId, {
                client: selfBot,
                tag: selfBot.user.tag
            });
        });

        // Evento para mensagens (aqui que o !pix será processado)
        selfBot.on('messageCreate', async (message) => {
            // Ignorar próprias mensagens
            if (message.author.id === selfBot.user.id) return;
            
            // Verificar prefixo
            if (!message.content.startsWith(PREFIX)) return;

            const args = message.content.slice(PREFIX.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // Comando PIX
            if (command === 'pix') {
                try {
                    console.log(`📱 Comando pix recebido de ${message.author.tag}`);
                    
                    if (args.length === 0) {
                        return message.reply(
                            '❌ **Como usar o Pix:**\n' +
                            '`!pix [chave]` - Ex: `!pix 11999999999`\n' +
                            '`!pix [valor] [chave]` - Ex: `!pix 50.00 11999999999`'
                        );
                    }

                    // Processar argumentos
                    let chave, valor;
                    if (args[0].match(/^[\d,.]+$/)) {
                        valor = args[0].replace(',', '.');
                        chave = args[1];
                    } else {
                        chave = args[0];
                        valor = null;
                    }

                    if (!chave) {
                        return message.reply('❌ Chave Pix não fornecida!');
                    }

                    // Gerar QR Code
                    const QRCode = require('qrcode');
                    const { AttachmentBuilder } = require('discord.js-selfbot-v13');
                    
                    // Payload simplificado
                    const chaveLimpa = chave.replace(/\D/g, '');
                    const payload = `0002010014br.gov.bcb.pix01${chaveLimpa.length.toString().padStart(2, '0')}${chaveLimpa}5204000053039865802BR5913DiscordBot6008BRASILIA6304A1B2`;
                    
                    const qrBuffer = await QRCode.toBuffer(payload);
                    const attachment = new AttachmentBuilder(qrBuffer, { name: 'pix.png' });

                    await message.reply({
                        content: `✅ **QR Code Pix gerado!**\nChave: \`${chave}\``,
                        files: [attachment]
                    });

                } catch (error) {
                    console.error('Erro no comando pix:', error);
                    await message.reply('❌ Erro ao gerar QR Code. Tente novamente.');
                }
            }
        });

        // Login do self-bot
        await selfBot.login(userData.userToken);
        return true;

    } catch (error) {
        console.error(`❌ Erro ao iniciar self-bot para ${userData.discordTag}:`, error.message);
        return false;
    }
}

// ===== EVENTO: BOT PRINCIPAL PRONTO =====
mainClient.once('ready', async () => {
    console.log(`✅ Bot Principal ONLINE: ${mainClient.user.tag}`);
    console.log(`📊 Carregando self-bots do banco de dados...`);

    // Carregar usuários do banco
    const db = fs.readJsonSync(usersDbPath);
    
    if (db.users.length === 0) {
        console.log('📭 Nenhum usuário registrado no banco');
    } else {
        console.log(`📋 Encontrados ${db.users.length} usuários registrados`);
        
        // Iniciar cada self-bot
        for (const user of db.users) {
            if (user.status === 'active') {
                await startSelfBot(user);
                // Pequena pausa para não sobrecarregar
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
});

// ===== EVENTO: MENSAGENS NO BOT PRINCIPAL =====
mainClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ===== COMANDOS DE ADMIN =====
    
    // !ping - Teste
    if (command === 'ping') {
        return message.reply('🏓 Pong!');
    }

    // !status - Status do sistema
    if (command === 'status') {
        const db = fs.readJsonSync(usersDbPath);
        return message.reply(
            `📊 **STATUS DO SISTEMA**\n\n` +
            `🤖 Bot Principal: 🟢 Online\n` +
            `👥 Usuários registrados: ${db.users.length}\n` +
            `🟢 Self-bots online: ${activeSelfBots.size}\n` +
            `🔴 Self-bots offline: ${db.users.length - activeSelfBots.size}`
        );
    }

    // !listar - Listar usuários
    if (command === 'listar') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode usar este comando!');
        }

        const db = fs.readJsonSync(usersDbPath);
        
        if (db.users.length === 0) {
            return message.reply('📭 Nenhum usuário registrado.');
        }

        let lista = '📋 **USUÁRIOS REGISTRADOS**\n\n';
        
        for (const user of db.users) {
            const online = activeSelfBots.has(user.userId) ? '🟢 Online' : '🔴 Offline';
            lista += `**${user.discordTag}**\n`;
            lista += `└ ID: \`${user.userId}\`\n`;
            lista += `└ Status: ${online}\n`;
            lista += `└ Comandos: ${user.commandsUsed || 0}\n\n`;
        }

        await message.reply(lista);
    }

    /// !registrar - Registrar novo usuário (VERSÃO COM DEBUG)
if (command === 'registrar') {
    console.log('📝 Comando registrar recebido');
    console.log('Autor:', message.author.tag);
    console.log('Admin ID:', ADMIN_ID);
    
    // Verificar permissão
    if (message.author.id !== ADMIN_ID) {
        console.log('❌ Permissão negada');
        return message.reply('❌ Apenas o administrador pode usar este comando!');
    }

    // Verificar argumentos
    if (args.length < 2) {
        console.log('❌ Argumentos insuficientes:', args);
        return message.reply('❌ Use: `!registrar [ID] [token]`');
    }

    const userId = args[0];
    const userToken = args[1];

    console.log('📋 Dados recebidos:');
    console.log('  User ID:', userId);
    console.log('  Token:', userToken ? '[PROTEGIDO]' : 'não fornecido');

    try {
        // Enviar mensagem de processamento
        await message.reply('🔄 Processando registro...');

        // TESTAR TOKEN
        console.log('🔄 Testando token...');
        
        let SelfBotClient;
        try {
            SelfBotClient = require('discord.js-selfbot-v13').Client;
            console.log('✅ Biblioteca selfbot carregada');
        } catch (err) {
            console.error('❌ Erro ao carregar biblioteca:', err);
            return message.reply('❌ Erro: biblioteca discord.js-selfbot-v13 não instalada!');
        }

        const testClient = new SelfBotClient({ 
            checkUpdate: false,
            http: { version: 10 }
        });
        
        let userTag = 'Desconhecido';
        
        try {
            console.log('🔄 Tentando login com token...');
            await testClient.login(userToken);
            console.log('✅ Login bem sucedido!');
            
            userTag = testClient.user.tag;
            console.log('👤 Usuário:', userTag);
            
            await testClient.destroy();
            console.log('✅ Cliente de teste destruído');
            
        } catch (loginError) {
            console.error('❌ Erro no login:', loginError.message);
            
            if (loginError.message.includes('invalid token')) {
                return message.reply('❌ Token inválido! O token fornecido não é válido.');
            } else if (loginError.message.includes('Privileged intent')) {
                return message.reply('❌ Erro de intent. Isso não deveria acontecer em selfbot.');
            } else {
                return message.reply(`❌ Erro no login: ${loginError.message}`);
            }
        }

        // SALVAR NO BANCO
        console.log('🔄 Salvando no banco de dados...');
        
        const db = fs.readJsonSync(usersDbPath);
        console.log('📊 Banco atual tem', db.users.length, 'usuários');
        
        // Verificar se já existe
        const existingUser = db.users.find(u => u.userId === userId);
        if (existingUser) {
            console.log('⚠️ Usuário já existe');
            return message.reply('❌ Este usuário já está registrado!');
        }

        // Criar novo usuário
        const newUser = {
            userId,
            discordTag: userTag,
            userToken,
            status: 'active',
            registeredAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            commandsUsed: 0
        };

        db.users.push(newUser);
        fs.writeJsonSync(usersDbPath, db);
        console.log('✅ Usuário salvo no banco');

        // INICIAR SELF-BOT
        console.log('🔄 Iniciando self-bot...');
        
        try {
            const selfBot = new SelfBotClient({ 
                checkUpdate: false,
                http: { version: 10 }
            });

            selfBot.once('ready', () => {
                console.log(`✅ Self-bot ONLINE: ${selfBot.user.tag}`);
                activeSelfBots.set(userId, {
                    client: selfBot,
                    tag: selfBot.user.tag
                });
            });

            selfBot.on('messageCreate', async (msg) => {
                // Comando pix no self-bot
                if (msg.content.startsWith(PREFIX + 'pix')) {
                    const pixArgs = msg.content.slice(PREFIX.length + 3).trim().split(/ +/);
                    console.log('📱 Comando pix no self-bot:', pixArgs);
                    
                    // Aqui vai a lógica do pix (simplificada por enquanto)
                    await msg.reply('✅ Comando pix recebido! Em breve implementarei o QR Code aqui.');
                }
            });

            await selfBot.login(userToken);
            console.log('✅ Self-bot iniciado com sucesso');

        } catch (selfBotError) {
            console.error('❌ Erro ao iniciar self-bot:', selfBotError.message);
            // Não falha o registro, apenas avisa
        }

        // RESPOSTA DE SUCESSO
        await message.reply(
            `✅ **USUÁRIO REGISTRADO COM SUCESSO!**\n\n` +
            `📋 **Detalhes:**\n` +
            `• Usuário: **${userTag}**\n` +
            `• ID: \`${userId}\`\n` +
            `• Token: Válido ✅\n` +
            `• Self-bot: Iniciando...\n\n` +
            `📱 **Próximos passos:**\n` +
            `1️⃣ Aguarde o self-bot ficar online\n` +
            `2️⃣ Use \`!listar\` para verificar\n` +
            `3️⃣ O usuário já pode usar \`!pix\` na própria conta`
        );

    } catch (error) {
        console.error('❌ ERRO GERAL NO REGISTRO:', error);
        console.error('Stack:', error.stack);
        await message.reply(`❌ Erro ao registrar usuário: ${error.message}`);
    }
}

    // !remover - Remover usuário
    if (command === 'remover') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode usar este comando!');
        }

        if (args.length < 1) {
            return message.reply('❌ Use: `!remover [ID]`');
        }

        const userId = args[0];
        const db = fs.readJsonSync(usersDbPath);
        
        const index = db.users.findIndex(u => u.userId === userId);
        
        if (index === -1) {
            return message.reply('❌ Usuário não encontrado!');
        }

        // Desconectar self-bot se estiver online
        if (activeSelfBots.has(userId)) {
            const selfBot = activeSelfBots.get(userId).client;
            await selfBot.destroy();
            activeSelfBots.delete(userId);
        }

        // Remover do banco
        db.users.splice(index, 1);
        fs.writeJsonSync(usersDbPath, db);

        await message.reply('✅ Usuário removido com sucesso!');
    }
});

// ===== INICIAR BOT PRINCIPAL =====
if (!MAIN_BOT_TOKEN) {
    console.error('❌ MAIN_BOT_TOKEN não encontrado!');
    process.exit(1);
}

mainClient.login(MAIN_BOT_TOKEN).catch(err => {
    console.error('❌ Erro no login do bot principal:', err.message);
    process.exit(1);
});

// ===== KEEP ALIVE =====
setInterval(() => {
    console.log(`💓 Heartbeat - Self-bots online: ${activeSelfBots.size}`);
}, 60000);