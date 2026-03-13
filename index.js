require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
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

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    try {
        // Remover formatação da chave
        let chaveLimpa = chave.replace(/[^\w@.-]/g, '');
        
        // Identificar tipo de chave
        if (chaveLimpa.includes('@')) {
            // Email - manter como está
        } else {
            // Telefone, CPF, CNPJ - remover tudo que não for número
            chaveLimpa = chaveLimpa.replace(/\D/g, '');
        }
        
        // Se a chave ficou vazia, usar original
        if (!chaveLimpa || chaveLimpa.length < 3) chaveLimpa = chave;
        
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
        payload += '5913DiscordBotPix';
        
        // Merchant City
        payload += '6008BRASILIA';
        
        // Adicionar valor se fornecido
        if (valor) {
            const valorNum = parseFloat(valor).toFixed(2);
            const valorStr = valorNum.replace('.', '');
            payload += `54${valorStr.length.toString().padStart(2, '0')}${valorNum}`;
        }
        
        // Additional Data Field (descrição)
        if (descricao && descricao !== 'Pagamento via Pix') {
            const descLimpa = descricao.substring(0, 20);
            payload += `62${(descLimpa.length + 4).toString().padStart(2, '0')}05${descLimpa.length.toString().padStart(2, '0')}${descLimpa}`;
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
        console.log(`🔄 Iniciando self-bot para ${userData.discordTag}...`);
        
        // Importar self-bot
        const { Client: SelfBotClient } = require('discord.js-selfbot-v13');
        
        const selfBot = new SelfBotClient({ 
            checkUpdate: false,
            readyTimeout: 60000
        });

        selfBot.once('ready', () => {
            console.log(`✅ Self-bot online: ${selfBot.user.tag}`);
            activeSelfBots.set(userData.userId, {
                client: selfBot,
                tag: selfBot.user.tag,
                userId: userData.userId
            });
            
            // Atualizar status no banco
            const userIndex = users.findIndex(u => u.userId === userData.userId);
            if (userIndex >= 0) {
                users[userIndex].status = 'online';
                users[userIndex].lastOnline = new Date().toISOString();
                saveUsers();
            }
        });

        // ===== PROCESSAR COMANDOS NO SELF-BOT (VERSÃO CORRIGIDA) =====
        selfBot.on('messageCreate', async (message) => {
            try {
                // LOG PARA DEBUG
                console.log(`📨 Self-bot [${selfBot.user.tag}] recebeu: "${message.content}" de ${message.author.tag}`);
                
                // 1. IGNORAR PRÓPRIAS MENSAGENS
                if (message.author.id === selfBot.user.id) {
                    console.log('  ⏭️ Ignorando própria mensagem');
                    return;
                }

                // 2. VERIFICAR SE É DM (mais confiável para testes)
                const isDM = message.channel.type === 'DM';
                console.log(`  📍 Canal: ${isDM ? 'DM' : 'Servidor'}`);

                // 3. VERIFICAR SE COMEÇA COM PREFIXO
                if (!message.content.startsWith(PREFIX)) {
                    console.log('  ⏭️ Não começa com prefixo');
                    return;
                }

                // 4. PROCESSAR COMANDO
                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                
                console.log(`  🎯 Comando detectado: "${command}"`);
                console.log(`  📋 Argumentos:`, args);

                // 5. COMANDO DE TESTE
                if (command === 'teste') {
                    await message.reply('✅ Self-bot funcionando perfeitamente!');
                    console.log('  ✅ Comando teste executado');
                    return;
                }

                // 6. COMANDO PIX
                if (command === 'pix') {
                    console.log('✅ EXECUTANDO COMANDO PIX');
                    
                    // Verificar se tem argumentos
                    if (args.length === 0) {
                        console.log('  ⚠️ Sem argumentos');
                        await message.reply(
                            '❌ **Como usar o Pix:**\n' +
                            '`!pix [chave]` - Ex: `!pix 11999999999`\n' +
                            '`!pix [chave] [descrição]` - Ex: `!pix 11999999999 Pizza`\n' +
                            '`!pix [valor] [chave] [descrição]` - Ex: `!pix 50.00 11999999999 Jantar`'
                        );
                        return;
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

                    if (!chavePix) {
                        await message.reply('❌ Chave Pix não fornecida!');
                        return;
                    }

                    console.log(`  🔑 Chave: ${chavePix}`);
                    if (valor) console.log(`  💰 Valor: ${valor}`);
                    if (descricao) console.log(`  📝 Descrição: ${descricao}`);

                    // Mensagem de processamento
                    const procMsg = await message.reply('🔄 Gerando QR Code Pix...');
                    console.log('  ✅ Mensagem de processamento enviada');

                    try {
                        // GERAR QR CODE
                        console.log('  🖼️ Gerando QR Code...');
                        
                        const QRCode = require('qrcode');
                        const { AttachmentBuilder } = require('discord.js-selfbot-v13');
                        
                        // Gerar payload
                        const payload = gerarPayloadPix(chavePix, valor, descricao);
                        
                        if (!payload) {
                            throw new Error('Falha ao gerar payload');
                        }
                        
                        console.log(`  📦 Payload gerado (${payload.length} chars)`);
                        
                        // Gerar imagem QR Code
                        const qrBuffer = await QRCode.toBuffer(payload, {
                            type: 'png',
                            width: 400,
                            margin: 2,
                            errorCorrectionLevel: 'M'
                        });
                        
                        console.log('  ✅ QR Code gerado em buffer');
                        
                        const attachment = new AttachmentBuilder(qrBuffer, { 
                            name: `pix-${Date.now()}.png` 
                        });

                        // Montar mensagem de resposta
                        let resposta = `✅ **QR Code Pix gerado!**\n\n`;
                        resposta += `📋 **Detalhes:**\n`;
                        resposta += `• Chave: \`${chavePix}\`\n`;
                        
                        if (valor) {
                            const valorFormatado = parseFloat(valor).toFixed(2);
                            resposta += `• Valor: R$ ${valorFormatado.replace('.', ',')}\n`;
                        }
                        
                        if (descricao && descricao !== 'Pagamento via Pix') {
                            resposta += `• Descrição: ${descricao}\n`;
                        }
                        
                        resposta += `\n📱 **Código Pix Copia e Cola:**\n`;
                        resposta += `\`\`\`${payload}\`\`\``;

                        // Enviar resposta
                        await message.reply({
                            content: resposta,
                            files: [attachment]
                        });
                        
                        console.log('  ✅ Resposta enviada com sucesso');
                        
                        // Apagar mensagem de processamento
                        await procMsg.delete();
                        
                        // Atualizar contador de comandos
                        const userIndex = users.findIndex(u => u.userId === userData.userId);
                        if (userIndex >= 0) {
                            users[userIndex].commandsUsed = (users[userIndex].commandsUsed || 0) + 1;
                            saveUsers();
                        }

                    } catch (qrError) {
                        console.error('  ❌ Erro ao gerar QR Code:', qrError);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code. Tente novamente com uma chave válida.');
                    }
                }

                // 7. COMANDO HELP
                if (command === 'help' || command === 'ajuda') {
                    await message.reply(
                        '**Comandos disponíveis:**\n' +
                        '`!pix [chave]` - Gerar QR Code Pix\n' +
                        '`!teste` - Testar se o self-bot está funcionando'
                    );
                }

            } catch (error) {
                console.error('❌ ERRO CRÍTICO NO SELF-BOT:', error);
                try {
                    await message.reply('❌ Erro interno ao processar comando.');
                } catch (e) {}
            }
        });

        await selfBot.login(userData.userToken);
        console.log(`✅ Self-bot ${userData.discordTag} iniciado com sucesso`);
        return true;
        
    } catch (err) {
        console.error(`❌ Erro ao iniciar self-bot para ${userData.discordTag}:`, err.message);
        return false;
    }
}

// ===== BOT PRINCIPAL =====
mainClient.once('ready', () => {
    console.log(`✅ Bot principal: ${mainClient.user.tag}`);
    console.log(`📊 Carregando ${users.length} usuários do banco de dados...`);
    
    // Iniciar self-bots existentes
    users.forEach(user => {
        if (user.status === 'active') {
            setTimeout(() => startSelfBot(user), 2000);
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
        const onlineCount = activeSelfBots.size;
        return message.reply(
            `📊 **STATUS DO SISTEMA**\n\n` +
            `🤖 Bot Principal: 🟢 Online\n` +
            `👥 Usuários registrados: ${users.length}\n` +
            `🟢 Self-bots online: ${onlineCount}\n` +
            `🔴 Self-bots offline: ${users.length - onlineCount}`
        );
    }

    // !listar (só admin)
    if (command === 'listar') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode usar este comando!');
        }
        
        if (users.length === 0) {
            return message.reply('📭 Nenhum usuário registrado.');
        }
        
        let lista = '📋 **USUÁRIOS REGISTRADOS**\n\n';
        users.forEach((u, index) => {
            const online = activeSelfBots.has(u.userId) ? '🟢 Online' : '🔴 Offline';
            lista += `**${index + 1}. ${u.discordTag}**\n`;
            lista += `└ ID: \`${u.userId}\`\n`;
            lista += `└ Status: ${online}\n`;
            lista += `└ Comandos: ${u.commandsUsed || 0}\n\n`;
        });
        
        return message.reply(lista);
    }

    // !registrar (só admin)
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
            await message.reply('🔄 Processando registro...');

            // Testar token
            console.log('🔄 Testando token...');
            const { Client: TestBot } = require('discord.js-selfbot-v13');
            const test = new TestBot({ checkUpdate: false });
            
            await test.login(userToken);
            const userTag = test.user.tag;
            await test.destroy();

            console.log(`✅ Token válido para ${userTag}`);

            // Verificar se já existe
            if (users.some(u => u.userId === userId)) {
                return message.reply('❌ Este usuário já está registrado!');
            }

            // Salvar
            const newUser = {
                userId,
                discordTag: userTag,
                userToken,
                status: 'active',
                registeredAt: new Date().toISOString(),
                commandsUsed: 0
            };

            users.push(newUser);
            saveUsers();

            // Iniciar self-bot
            const started = await startSelfBot(newUser);

            await message.reply(
                `✅ **USUÁRIO REGISTRADO COM SUCESSO!**\n\n` +
                `📋 **Detalhes:**\n` +
                `• Usuário: **${userTag}**\n` +
                `• ID: \`${userId}\`\n` +
                `• Self-bot: ${started ? '🟢 Online' : '🟡 Iniciando...'}\n\n` +
                `📱 O usuário já pode usar \`!pix\` na própria conta!`
            );

        } catch (err) {
            console.error('❌ Erro registro:', err);
            await message.reply(`❌ Erro ao registrar: ${err.message}`);
        }
    }

    // !remover (só admin)
    if (command === 'remover') {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode usar este comando!');
        }

        if (args.length < 1) {
            return message.reply('❌ Use: `!remover [ID]`');
        }

        const userId = args[0];
        const index = users.findIndex(u => u.userId === userId);
        
        if (index === -1) {
            return message.reply('❌ Usuário não encontrado!');
        }

        const userTag = users[index].discordTag;
        
        // Desconectar self-bot
        if (activeSelfBots.has(userId)) {
            try {
                const selfBot = activeSelfBots.get(userId).client;
                await selfBot.destroy();
            } catch (e) {}
            activeSelfBots.delete(userId);
        }

        // Remover do banco
        users.splice(index, 1);
        saveUsers();

        await message.reply(`✅ Usuário **${userTag}** removido com sucesso!`);
    }
});

// ===== INICIAR BOT PRINCIPAL =====
if (!MAIN_BOT_TOKEN) {
    console.error('❌ MAIN_BOT_TOKEN não encontrado nas variáveis de ambiente!');
    process.exit(1);
}

mainClient.login(MAIN_BOT_TOKEN).catch(err => {
    console.error('❌ Erro no login do bot principal:', err.message);
    process.exit(1);
});

// ===== KEEP ALIVE =====
setInterval(() => {
    console.log(`💓 Heartbeat - Self-bots online: ${activeSelfBots.size}/${users.length}`);
}, 60000);

// ===== TRATAMENTO DE ERROS =====
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});