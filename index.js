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
    res.send('✅ Pix Multi-Bot Online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

// ===== BANCO DE DADOS =====
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
const selfBotsAtivos = new Map(); // key: userId, value: { client, tag }

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    try {
        let chaveLimpa = chave.replace(/\D/g, '');
        if (!chaveLimpa || chaveLimpa.length < 3) chaveLimpa = chave;
        
        let payload = '0002010014br.gov.bcb.pix';
        
        const chaveLen = chaveLimpa.length.toString().padStart(2, '0');
        payload += `01${chaveLen}${chaveLimpa}`;
        
        payload += '5204000053039865802BR5913DiscordBot6008BRASILIA';
        
        if (valor) {
            const valorNum = parseFloat(valor).toFixed(2);
            const valorStr = valorNum.replace('.', '');
            payload += `54${valorStr.length.toString().padStart(2, '0')}${valorNum}`;
        }
        
        if (descricao && descricao !== 'Pagamento via Pix') {
            const descLimpa = descricao.substring(0, 20);
            payload += `62${(descLimpa.length + 4).toString().padStart(2, '0')}05${descLimpa.length.toString().padStart(2, '0')}${descLimpa}`;
        }
        
        payload += '6304A1B2';
        
        return payload;
    } catch (error) {
        console.error('Erro ao gerar payload:', error);
        return null;
    }
}

// ===== FUNÇÃO PARA INICIAR SELF-BOT DO USUÁRIO =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);
        
        const client = new SelfBotClient({ 
            checkUpdate: false 
        });

        client.on('ready', () => {
            console.log(`✅✅✅ SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();
            
            selfBotsAtivos.set(usuario.userId, {
                client,
                tag: client.user.tag
            });
            
            console.log(`🎯 ${client.user.tag} pronto para receber comandos em QUALQUER LUGAR!`);
        });

        // ===== PROCESSAR COMANDOS DO USUÁRIO EM QUALQUER LUGAR =====
        client.on('messageCreate', async (message) => {
            try {
                // 1. IGNORAR PRÓPRIAS MENSAGENS
                if (message.author.id === client.user.id) return;
                
                // 2. VERIFICAR SE É O PRÓPRIO USUÁRIO (dono da conta)
                // O self-bot só responde para a própria conta dele
                if (message.author.id !== usuario.userId) {
                    return; // Ignora mensagens de outras pessoas
                }
                
                // 3. LOG PARA DEBUG
                console.log(`📨 [${client.user.tag}] Usuário enviou: "${message.content}" em ${message.channel.type}`);
                
                // 4. VERIFICAR SE É COMANDO
                if (!message.content.startsWith(PREFIX)) return;
                
                // 5. PROCESSAR COMANDO
                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                
                console.log(`  🎯 Comando: ${command}`);
                
                // ===== COMANDO: !ping =====
                if (command === 'ping') {
                    await message.reply('🏓 **Pong!**');
                    console.log('  ✅ Ping respondido');
                }
                
                // ===== COMANDO: !teste =====
                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando perfeitamente!**');
                    console.log('  ✅ Teste respondido');
                }
                
                // ===== COMANDO: !help =====
                if (command === 'help' || command === 'ajuda') {
                    await message.reply(
                        '📋 **COMANDOS DISPONÍVEIS:**\n\n' +
                        '`!ping` - Testar conexão\n' +
                        '`!teste` - Testar funcionamento\n' +
                        '`!pix [chave]` - Gerar QR Code Pix\n' +
                        '`!pix [chave] [descrição]` - Pix com descrição\n' +
                        '`!pix [valor] [chave] [descrição]` - Pix com valor\n' +
                        '`!help` - Mostrar esta ajuda'
                    );
                }
                
                // ===== COMANDO: !pix =====
                if (command === 'pix') {
                    console.log(`  🎯 Executando PIX para ${client.user.tag}`);
                    
                    if (args.length === 0) {
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

                    // Mensagem de processamento
                    const procMsg = await message.reply('🔄 **Gerando QR Code Pix...**');
                    
                    try {
                        // Gerar payload
                        const payload = gerarPayloadPix(chavePix, valor, descricao);
                        
                        if (!payload) {
                            throw new Error('Falha ao gerar payload');
                        }
                        
                        // Gerar QR Code
                        const qrBuffer = await QRCode.toBuffer(payload, {
                            type: 'png',
                            width: 400,
                            margin: 2
                        });
                        
                        const attachment = new AttachmentBuilder(qrBuffer, { 
                            name: `pix-${Date.now()}.png` 
                        });

                        // Montar resposta
                        let resposta = `✅ **QR CODE PIX GERADO!**\n\n`;
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
                        
                        await procMsg.delete();
                        
                        console.log(`  ✅ QR Code enviado para ${chavePix}`);
                        
                        // Atualizar contador
                        usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                        salvarUsuarios();

                    } catch (error) {
                        console.error('  ❌ Erro no QR Code:', error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code. Tente novamente.');
                    }
                }
                
            } catch (error) {
                console.error('❌ Erro no self-bot:', error);
            }
        });

        client.on('error', (error) => {
            console.error(`❌ Erro no self-bot de ${usuario.discordTag}:`, error.message);
            usuario.status = 'offline';
            salvarUsuarios();
            selfBotsAtivos.delete(usuario.userId);
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

// ===== BOT PRINCIPAL (GERENCIADOR) =====
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
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === ADMIN_ID;

    // Comando público
    if (command === 'ping') {
        return message.reply('🏓 Pong!');
    }

    // Comandos de admin (só você pode usar)
    if (!isAdmin) return;

    if (command === 'status') {
        return message.reply(
            `📊 **STATUS**\n\n` +
            `👥 Usuários: ${usuarios.length}\n` +
            `🟢 Online: ${selfBotsAtivos.size}\n` +
            `🔴 Offline: ${usuarios.length - selfBotsAtivos.size}`
        );
    }

    if (command === 'listar') {
        if (usuarios.length === 0) {
            return message.reply('📭 Nenhum usuário.');
        }
        
        let lista = '📋 **USUÁRIOS**\n\n';
        for (const u of usuarios) {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} **${u.discordTag || u.userId}**\n`;
        }
        return message.reply(lista);
    }

    if (command === 'registrar') {
        if (args.length < 2) {
            return message.reply('❌ Use: `!registrar [ID] [token]`');
        }

        const userId = args[0];
        const userToken = args[1];

        const msgProc = await message.reply('🔄 Processando...');

        try {
            // Verificar se já existe
            if (usuarios.some(u => u.userId === userId)) {
                return msgProc.edit('❌ Usuário já registrado!');
            }

            // Testar token
            const testClient = new SelfBotClient({ checkUpdate: false });
            let userTag;
            
            try {
                await testClient.login(userToken);
                userTag = testClient.user.tag;
                await testClient.destroy();
            } catch (err) {
                return msgProc.edit('❌ Token inválido!');
            }

            // Criar usuário
            const novoUsuario = {
                userId,
                discordTag: userTag,
                userToken,
                status: 'active',
                registradoEm: new Date().toISOString(),
                comandosUsados: 0
            };

            usuarios.push(novoUsuario);
            salvarUsuarios();

            // Iniciar self-bot
            const iniciou = await iniciarSelfBot(novoUsuario);

            await msgProc.edit(
                `✅ **USUÁRIO REGISTRADO!**\n\n` +
                `• Usuário: **${userTag}**\n` +
                `• Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}\n\n` +
                `📱 O usuário agora pode usar:\n` +
                `!teste\n` +
                `!pix 11999999999\n` +
                `Em QUALQUER lugar do Discord!`
            );

        } catch (error) {
            console.error('Erro:', error);
            await msgProc.edit(`❌ Erro: ${error.message}`);
        }
    }

    if (command === 'remover') {
        if (args.length < 1) {
            return message.reply('❌ Use: `!remover [ID]`');
        }

        const userId = args[0];
        const index = usuarios.findIndex(u => u.userId === userId);

        if (index === -1) {
            return message.reply('❌ Usuário não encontrado!');
        }

        const userTag = usuarios[index].discordTag;

        // Desconectar
        if (selfBotsAtivos.has(userId)) {
            try {
                await selfBotsAtivos.get(userId).client.destroy();
                selfBotsAtivos.delete(userId);
            } catch (err) {}
        }

        usuarios.splice(index, 1);
        salvarUsuarios();

        await message.reply(`✅ Usuário **${userTag}** removido!`);
    }
});

// ===== INICIAR BOT PRINCIPAL =====
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN não configurado!');
    process.exit(1);
}

botPrincipal.login(BOT_TOKEN).catch(err => {
    console.error('❌ Erro no login:', err);
    process.exit(1);
});

// ===== HEARTBEAT =====
setInterval(() => {
    console.log(`💓 Heartbeat - Usuários: ${usuarios.length} | Online: ${selfBotsAtivos.size}`);
}, 60000);