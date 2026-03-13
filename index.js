require('dotenv').config();
const express = require('express');
const fs = require('fs-extra');
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
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

// ===== BANCO DE DADOS =====
const dbPath = path.join('/tmp', 'database.json');

let usuarios = [];
try {
    if (fs.existsSync(dbPath)) {
        usuarios = fs.readJsonSync(dbPath);
        console.log(`📂 Banco carregado: ${usuarios.length} usuários`);
    } else {
        fs.writeJsonSync(dbPath, []);
        console.log('📂 Novo banco criado');
    }
} catch (error) {
    console.error('Erro ao carregar banco:', error);
    usuarios = [];
}

function salvarUsuarios() {
    try {
        fs.writeJsonSync(dbPath, usuarios, { spaces: 2 });
    } catch (error) {
        console.error('Erro ao salvar banco:', error);
    }
}

// ===== SELF-BOTS ATIVOS =====
const selfBotsAtivos = new Map();

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

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
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
            usuario.ultimaAtividade = new Date().toISOString();
            salvarUsuarios();
            
            selfBotsAtivos.set(usuario.userId, {
                client,
                tag: client.user.tag,
                userId: usuario.userId
            });
            
            console.log(`🎯 Self-bot ${client.user.tag} pronto para receber comandos!`);
        });

        // PROCESSAR MENSAGENS NO SELF-BOT
        client.on('messageCreate', async (message) => {
            try {
                // Log detalhado de toda mensagem recebida
                console.log(`\n📨 [SELF-BOT ${client.user.tag}] Mensagem recebida:`);
                console.log(`  De: ${message.author.tag} (${message.author.id})`);
                console.log(`  Conteúdo: "${message.content}"`);
                console.log(`  Canal: ${message.channel.type}`);
                
                // Ignorar próprias mensagens
                if (message.author.id === client.user.id) {
                    console.log(`  ⏭️ Ignorando própria mensagem`);
                    return;
                }

                // Verificar se começa com prefixo
                if (!message.content.startsWith(PREFIX)) {
                    console.log(`  ⏭️ Não começa com prefixo ${PREFIX}`);
                    return;
                }

                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                
                console.log(`  🎯 Comando detectado: "${command}"`);
                console.log(`  📋 Argumentos:`, args);

                // COMANDO TESTE
                if (command === 'teste') {
                    console.log(`  ✅ Executando comando TESTE`);
                    await message.reply('✅ **Self-bot funcionando perfeitamente!**');
                    return;
                }

                // COMANDO PING
                if (command === 'ping') {
                    console.log(`  ✅ Executando comando PING`);
                    await message.reply('🏓 **Pong!**');
                    return;
                }

                // COMANDO HELP
                if (command === 'help' || command === 'ajuda') {
                    console.log(`  ✅ Executando comando HELP`);
                    await message.reply(
                        '📋 **COMANDOS DISPONÍVEIS:**\n\n' +
                        '`!ping` - Testar conexão\n' +
                        '`!teste` - Testar funcionamento\n' +
                        '`!pix [chave]` - Gerar QR Code Pix\n' +
                        '`!pix [chave] [descrição]` - Pix com descrição\n' +
                        '`!pix [valor] [chave] [descrição]` - Pix com valor\n' +
                        '`!help` - Mostrar esta ajuda'
                    );
                    return;
                }

                // COMANDO PIX
                if (command === 'pix') {
                    console.log(`  🎯 EXECUTANDO COMANDO PIX`);
                    
                    if (args.length === 0) {
                        await message.reply(
                            '❌ **Como usar o Pix:**\n' +
                            '`!pix [chave]` - Ex: `!pix 11999999999`\n' +
                            '`!pix [chave] [descrição]` - Ex: `!pix 11999999999 Pizza`\n' +
                            '`!pix [valor] [chave] [descrição]` - Ex: `!pix 50.00 11999999999 Jantar`'
                        );
                        return;
                    }

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

                    console.log(`  🔑 Chave: ${chavePix}`);
                    if (valor) console.log(`  💰 Valor: ${valor}`);
                    if (descricao) console.log(`  📝 Descrição: ${descricao}`);

                    const procMsg = await message.reply('🔄 **Gerando QR Code Pix...**');
                    
                    try {
                        const payload = gerarPayloadPix(chavePix, valor, descricao);
                        
                        if (!payload) {
                            throw new Error('Falha ao gerar payload');
                        }
                        
                        const qrBuffer = await QRCode.toBuffer(payload, {
                            type: 'png',
                            width: 400,
                            margin: 2
                        });
                        
                        const attachment = new AttachmentBuilder(qrBuffer, { 
                            name: `pix-${Date.now()}.png` 
                        });

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

                        await message.reply({
                            content: resposta,
                            files: [attachment]
                        });
                        
                        await procMsg.delete();
                        
                        console.log(`  ✅ QR Code enviado com sucesso!`);
                        
                        // Atualizar contador
                        usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                        salvarUsuarios();

                    } catch (error) {
                        console.error(`  ❌ Erro no QR Code:`, error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code. Tente novamente.');
                    }
                }

            } catch (error) {
                console.error('❌ Erro no self-bot:', error);
            }
        });

        client.on('error', (error) => {
            console.error(`❌ Erro no self-bot de ${usuario.discordTag || usuario.userId}:`, error.message);
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
async function iniciarTodosSelfBots() {
    console.log(`🔄 Iniciando ${usuarios.length} self-bots...`);
    
    for (const usuario of usuarios) {
        if (usuario.status === 'active' || usuario.status === 'online') {
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
    console.log(`✅ Bot Principal online: ${botPrincipal.user.tag}`);
    console.log(`📝 Prefixo: ${PREFIX}`);
    console.log(`🆔 Admin ID: ${ADMIN_ID}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === ADMIN_ID;

    // Comandos públicos
    if (command === 'ping') {
        return message.reply('🏓 **Pong!**');
    }

    // Comandos de admin
    if (!isAdmin) {
        return message.reply('❌ Apenas o administrador pode usar este comando.');
    }

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
            return message.reply('📭 Nenhum usuário registrado.');
        }
        
        let lista = '📋 **USUÁRIOS**\n\n';
        for (const u of usuarios) {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} **${u.discordTag || 'Desconhecido'}**\n`;
            lista += `└ ID: \`${u.userId}\`\n`;
            lista += `└ Comandos: ${u.comandosUsados || 0}\n\n`;
        }
        await message.reply(lista);
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
                `📱 O usuário já pode usar \`!teste\` e \`!pix\` na própria conta!`
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

        // Desconectar
        if (selfBotsAtivos.has(userId)) {
            try {
                await selfBotsAtivos.get(userId).client.destroy();
                selfBotsAtivos.delete(userId);
            } catch (err) {}
        }

        const userTag = usuarios[index].discordTag;
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