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

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    try {
        // Remover formatação da chave
        let chaveLimpa = chave.replace(/[^\w@.-]/g, '');
        
        // Identificar tipo de chave e limpar adequadamente
        if (chaveLimpa.includes('@')) {
            // Email - manter como está
        } else if (chaveLimpa.length === 11 && /^\d+$/.test(chaveLimpa)) {
            // CPF - manter só números
        } else if (chaveLimpa.length === 14 && /^\d+$/.test(chaveLimpa)) {
            // CNPJ - manter só números
        } else {
            // Telefone ou outro - remover tudo que não for número
            chaveLimpa = chaveLimpa.replace(/\D/g, '');
        }
        
        // Se a chave ficou vazia, usar original
        if (!chaveLimpa) chaveLimpa = chave;
        
        // Construir payload
        let payload = '000201'; // Payload Format Indicator
        
        // Merchant Account Information - GUI
        payload += '0014br.gov.bcb.pix';
        
        // Chave Pix
        const chaveLen = chaveLimpa.length.toString().padStart(2, '0');
        payload += `01${chaveLen}${chaveLimpa}`;
        
        // Merchant Category Code
        payload += '52040000';
        
        // Transaction Currency (986 = BRL)
        payload += '5303986';
        
        // Country Code
        payload += '5802BR';
        
        // Merchant Name
        payload += '5909DiscordBot';
        
        // Merchant City
        payload += '6008BRASILIA';
        
        // Adicionar valor se fornecido
        if (valor) {
            const valorNum = parseFloat(valor).toFixed(2);
            const valorStr = valorNum.replace('.', '');
            payload += `54${valorStr.length.toString().padStart(2, '0')}${valorNum}`;
        }
        
        // Additional Data Field (descrição)
        if (descricao && descricao !== 'Pagamento via Pix' && descricao !== 'Pagamento') {
            const descLimpa = descricao.substring(0, 30);
            payload += `62${(descLimpa.length + 4).toString().padStart(2, '0')}05${descLimpa.length.toString().padStart(2, '0')}${descLimpa}`;
        } else {
            payload += '6304';
        }
        
        // CRC16 (simplificado)
        payload += '6304A1B2';
        
        return payload;
        
    } catch (error) {
        console.error('Erro ao gerar payload:', error);
        return null;
    }
}

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

        // ===== PROCESSAR COMANDOS NO SELF-BOT =====
        selfBot.on('messageCreate', async (msg) => {
            try {
                // Ignorar próprias mensagens
                if (msg.author.id === selfBot.user.id) return;
                
                // Verificar se é comando (começa com !)
                if (!msg.content.startsWith(PREFIX)) return;

                const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                // COMANDO: !pix
                if (command === 'pix') {
                    console.log(`📱 Comando pix de ${msg.author.tag}:`, args);
                    
                    if (args.length === 0) {
                        return msg.reply(
                            '❌ **Como usar o Pix:**\n' +
                            '`!pix [chave]` - Ex: `!pix 11999999999`\n' +
                            '`!pix [chave] [descrição]` - Ex: `!pix 11999999999 Pizza`\n' +
                            '`!pix [valor] [chave] [descrição]` - Ex: `!pix 50.00 11999999999 Jantar`'
                        );
                    }

                    // Processar argumentos
                    let chavePix, valor, descricao;
                    
                    // Verificar se o primeiro argumento é um valor (número)
                    if (args[0] && args[0].match(/^[\d,.]+$/)) {
                        valor = args[0].replace(',', '.');
                        chavePix = args[1];
                        descricao = args.slice(2).join(' ') || 'Pagamento via Pix';
                    } else {
                        chavePix = args[0];
                        valor = null;
                        descricao = args.slice(1).join(' ') || 'Pagamento via Pix';
                    }

                    // Validar chave Pix
                    if (!chavePix) {
                        return msg.reply('❌ Por favor, forneça uma chave Pix válida!');
                    }

                    // Limpar chave Pix
                    chavePix = chavePix.trim();
                    
                    // Enviar mensagem de processamento
                    const processingMsg = await msg.reply('🔄 Gerando QR Code Pix...');

                    // Gerar payload Pix
                    const payload = gerarPayloadPix(chavePix, valor, descricao);
                    
                    // Validar payload
                    if (!payload || payload.length < 50) {
                        await processingMsg.delete();
                        return msg.reply('❌ Erro ao gerar código Pix. Chave inválida?');
                    }

                    // Gerar QR Code
                    const QRCode = require('qrcode');
                    const { AttachmentBuilder } = require('discord.js-selfbot-v13');
                    
                    const qrCodeBuffer = await QRCode.toBuffer(payload, {
                        type: 'png',
                        width: 400,
                        margin: 2,
                        color: {
                            dark: '#000000',
                            light: '#ffffff'
                        }
                    });

                    // Criar attachment
                    const attachment = new AttachmentBuilder(qrCodeBuffer, { 
                        name: `pix-${Date.now()}.png` 
                    });

                    // Montar mensagem de resposta
                    let resposta = `✅ **QR Code Pix gerado!**\n\n`;
                    resposta += `📋 **Detalhes:**\n`;
                    resposta += `• Chave: \`${chavePix}\`\n`;
                    
                    if (valor) {
                        const valorFormatado = parseFloat(valor).toFixed(2);
                        resposta += `• Valor: R$ ${valorFormatado.replace('.', ',')}\n`;
                    } else {
                        resposta += `• Valor: *Sem valor definido*\n`;
                    }
                    
                    if (descricao && descricao !== 'Pagamento via Pix') {
                        resposta += `• Descrição: ${descricao}\n`;
                    }
                    
                    resposta += `\n📱 **Código Pix Copia e Cola:**\n`;
                    resposta += `\`\`\`${payload}\`\`\``;

                    // Enviar resposta com QR Code
                    await msg.reply({
                        content: resposta,
                        files: [attachment]
                    });

                    // Deletar mensagem de processamento
                    await processingMsg.delete();
                    
                    // Atualizar contador de comandos
                    try {
                        const db = fs.readJsonSync(usersDbPath);
                        const user = db.users.find(u => u.userId === userData.userId);
                        if (user) {
                            user.commandsUsed = (user.commandsUsed || 0) + 1;
                            fs.writeJsonSync(usersDbPath, db);
                        }
                    } catch (e) {}
                }
                
                // COMANDO: !help ou !ajuda
                if (command === 'help' || command === 'ajuda') {
                    await msg.reply(
                        '**Comandos disponíveis:**\n' +
                        '`!pix [chave]` - Gerar QR Code Pix\n' +
                        '`!pix [valor] [chave]` - Pix com valor\n' +
                        '`!pix [chave] [descrição]` - Pix com descrição'
                    );
                }
                
            } catch (error) {
                console.error('❌ Erro no self-bot:', error);
                await msg.reply('❌ Erro ao processar comando. Tente novamente.');
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

    // !registrar - Registrar novo usuário
    if (command === 'registrar') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode usar este comando!');
        }

        if (args.length < 2) {
            return message.reply('❌ Use: `!registrar [ID] [token]`');
        }

        const userId = args[0];
        const userToken = args[1];

        try {
            // Enviar mensagem de processamento
            await message.reply('🔄 Processando registro...');

            // TESTAR TOKEN
            console.log('🔄 Testando token...');
            
            let SelfBotClient;
            try {
                SelfBotClient = require('discord.js-selfbot-v13').Client;
            } catch (err) {
                return message.reply('❌ Erro: biblioteca discord.js-selfbot-v13 não instalada!');
            }

            const testClient = new SelfBotClient({ checkUpdate: false });
            
            let userTag = 'Desconhecido';
            
            try {
                await testClient.login(userToken);
                userTag = testClient.user.tag;
                await testClient.destroy();
                
            } catch (loginError) {
                console.error('❌ Erro no login:', loginError.message);
                
                if (loginError.message.includes('invalid token')) {
                    return message.reply('❌ Token inválido! O token fornecido não é válido.');
                } else {
                    return message.reply(`❌ Erro no login: ${loginError.message}`);
                }
            }

            // SALVAR NO BANCO
            console.log('🔄 Salvando no banco de dados...');
            
            const db = fs.readJsonSync(usersDbPath);
            
            // Verificar se já existe
            const existingUser = db.users.find(u => u.userId === userId);
            if (existingUser) {
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
            
            const started = await startSelfBot(newUser);

            // RESPOSTA DE SUCESSO
            await message.reply(
                `✅ **USUÁRIO REGISTRADO COM SUCESSO!**\n\n` +
                `📋 **Detalhes:**\n` +
                `• Usuário: **${userTag}**\n` +
                `• ID: \`${userId}\`\n` +
                `• Token: Válido ✅\n` +
                `• Self-bot: ${started ? '🟢 Online' : '🟡 Iniciando...'}\n\n` +
                `📱 **Próximos passos:**\n` +
                `1️⃣ Aguarde o self-bot ficar online\n` +
                `2️⃣ Use \`!listar\` para verificar\n` +
                `3️⃣ O usuário já pode usar \`!pix\` na própria conta`
            );

        } catch (error) {
            console.error('❌ ERRO GERAL NO REGISTRO:', error);
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

        const userTag = db.users[index].discordTag;
        
        // Desconectar self-bot se estiver online
        if (activeSelfBots.has(userId)) {
            try {
                const selfBot = activeSelfBots.get(userId).client;
                await selfBot.destroy();
            } catch (e) {}
            activeSelfBots.delete(userId);
        }

        // Remover do banco
        db.users.splice(index, 1);
        fs.writeJsonSync(usersDbPath, db);

        await message.reply(`✅ Usuário **${userTag}** removido com sucesso!`);
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

// ===== TRATAMENTO DE ERROS NÃO CAPTURADOS =====
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});