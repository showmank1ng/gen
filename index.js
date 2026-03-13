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

// ===== SERVIDOR WEB (para Render) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Pix Multi-Bot</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>✅ PIX MULTI-BOT ONLINE</h1>
                <p>Sistema multi-usuário funcionando</p>
            </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

// ===== BANCO DE DADOS =====
const dbPath = path.join('/tmp', 'database.json'); // /tmp no Render é persistente durante o uptime

// Carregar usuários do banco
let usuarios = [];
try {
    if (fs.existsSync(dbPath)) {
        usuarios = fs.readJsonSync(dbPath);
        console.log(`📂 Banco de dados carregado: ${usuarios.length} usuários`);
    } else {
        fs.writeJsonSync(dbPath, []);
        console.log('📂 Novo banco de dados criado');
    }
} catch (error) {
    console.error('Erro ao carregar banco:', error);
    usuarios = [];
}

// Função para salvar usuários
function salvarUsuarios() {
    try {
        fs.writeJsonSync(dbPath, usuarios, { spaces: 2 });
    } catch (error) {
        console.error('Erro ao salvar banco:', error);
    }
}

// ===== ARMAZENAR SELF-BOTS ATIVOS =====
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

// ===== FUNÇÃO PARA INICIAR SELF-BOT DE UM USUÁRIO =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 Iniciando self-bot para ${usuario.discordTag}...`);
        
        const client = new SelfBotClient({ 
            checkUpdate: false 
        });

        client.on('ready', () => {
            console.log(`✅ Self-bot online: ${client.user.tag}`);
            
            // Atualizar status
            usuario.status = 'online';
            usuario.ultimaAtividade = new Date().toISOString();
            salvarUsuarios();
            
            selfBotsAtivos.set(usuario.userId, {
                client,
                tag: client.user.tag,
                userId: usuario.userId
            });
        });

        client.on('messageCreate', async (message) => {
            try {
                if (message.author.id === client.user.id) return;
                if (!message.content.startsWith(PREFIX)) return;

                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                // Comandos disponíveis para o usuário
                if (command === 'ping') {
                    await message.reply('🏓 **Pong!**');
                }
                
                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando corretamente!**');
                }
                
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
                
                if (command === 'pix') {
                    console.log(`📱 Pix command de ${message.author.tag}`);
                    
                    if (args.length === 0) {
                        await message.reply(
                            '❌ **Como usar:**\n' +
                            '`!pix [chave]` - Ex: `!pix 11999999999`\n' +
                            '`!pix [chave] [descrição]` - Ex: `!pix 11999999999 Pizza`'
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
                        
                        // Atualizar contador de comandos
                        usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                        salvarUsuarios();

                    } catch (error) {
                        console.error('Erro no pix:', error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code. Tente novamente.');
                    }
                }
                
            } catch (error) {
                console.error('Erro no self-bot:', error);
            }
        });

        client.on('error', (error) => {
            console.error(`Erro no self-bot de ${usuario.discordTag}:`, error.message);
            usuario.status = 'offline';
            salvarUsuarios();
            selfBotsAtivos.delete(usuario.userId);
        });

        await client.login(usuario.userToken);
        return true;

    } catch (error) {
        console.error(`Erro ao iniciar self-bot para ${usuario.discordTag}:`, error.message);
        usuario.status = 'offline';
        salvarUsuarios();
        return false;
    }
}

// ===== INICIAR TODOS OS SELF-BOTS DO BANCO =====
async function iniciarTodosSelfBots() {
    console.log(`🔄 Iniciando ${usuarios.length} self-bots do banco de dados...`);
    
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
    console.log(`✅ Bot Principal online: ${botPrincipal.user.tag}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Verificar se é admin
    const isAdmin = message.author.id === ADMIN_ID;

    // ===== COMANDOS PÚBLICOS =====
    if (command === 'ping') {
        return message.reply('🏓 **Pong!**');
    }

    // ===== COMANDOS DE ADMIN =====
    if (!isAdmin) {
        return message.reply('❌ Apenas o administrador pode usar comandos de gerenciamento.');
    }

    // !status - Status do sistema
    if (command === 'status') {
        return message.reply(
            `📊 **STATUS DO SISTEMA**\n\n` +
            `👥 **Usuários:**\n` +
            `• Total registrados: ${usuarios.length}\n` +
            `• Self-bots online: ${selfBotsAtivos.size}\n` +
            `• Self-bots offline: ${usuarios.length - selfBotsAtivos.size}\n\n` +
            `📝 Use \`!listar\` para ver detalhes`
        );
    }

    // !listar - Listar usuários
    if (command === 'listar') {
        if (usuarios.length === 0) {
            return message.reply('📭 Nenhum usuário registrado.');
        }
        
        let lista = '📋 **USUÁRIOS REGISTRADOS**\n\n';
        
        for (let i = 0; i < usuarios.length; i++) {
            const u = usuarios[i];
            const online = selfBotsAtivos.has(u.userId) ? '🟢 Online' : '🔴 Offline';
            lista += `**${i + 1}. ${u.discordTag}**\n`;
            lista += `└ ID: \`${u.userId}\`\n`;
            lista += `└ Status: ${online}\n`;
            lista += `└ Comandos: ${u.comandosUsados || 0}\n`;
            lista += `└ Registro: ${new Date(u.registradoEm).toLocaleDateString('pt-BR')}\n\n`;
        }
        
        // Dividir mensagens longas
        if (lista.length > 2000) {
            const partes = lista.match(/.{1,1900}/g);
            for (const parte of partes) {
                await message.reply(parte);
            }
        } else {
            await message.reply(lista);
        }
    }

    // !registrar - Registrar novo usuário
    if (command === 'registrar') {
        if (args.length < 2) {
            return message.reply(
                '❌ **Como registrar um usuário:**\n' +
                '`!registrar [ID] [token]`\n\n' +
                '**Exemplo:**\n' +
                '`!registrar 123456789012345678 mfa.abc123def456...`'
            );
        }

        const userId = args[0];
        const userToken = args[1];

        const msgProcessamento = await message.reply('🔄 Processando registro...');

        try {
            // Verificar se já existe
            if (usuarios.some(u => u.userId === userId)) {
                return msgProcessamento.edit('❌ Este usuário já está registrado!');
            }

            // Testar token
            const testClient = new SelfBotClient({ checkUpdate: false });
            
            let userTag;
            try {
                await testClient.login(userToken);
                userTag = testClient.user.tag;
                await testClient.destroy();
            } catch (err) {
                return msgProcessamento.edit('❌ Token inválido! Verifique o token e tente novamente.');
            }

            // Criar novo usuário
            const novoUsuario = {
                userId,
                discordTag: userTag,
                userToken,
                status: 'active',
                registradoEm: new Date().toISOString(),
                ultimaAtividade: new Date().toISOString(),
                comandosUsados: 0
            };

            usuarios.push(novoUsuario);
            salvarUsuarios();

            // Iniciar self-bot
            const iniciou = await iniciarSelfBot(novoUsuario);

            await msgProcessamento.edit(
                `✅ **USUÁRIO REGISTRADO COM SUCESSO!**\n\n` +
                `📋 **Detalhes:**\n` +
                `• Usuário: **${userTag}**\n` +
                `• ID: \`${userId}\`\n` +
                `• Token: ✅ Válido\n` +
                `• Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}\n\n` +
                `📱 O usuário agora pode usar \`!pix\` na própria conta!`
            );

        } catch (error) {
            console.error('Erro no registro:', error);
            await msgProcessamento.edit(`❌ Erro ao registrar: ${error.message}`);
        }
    }

    // !remover - Remover usuário
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

        // Desconectar self-bot se estiver online
        if (selfBotsAtivos.has(userId)) {
            try {
                const selfBot = selfBotsAtivos.get(userId).client;
                await selfBot.destroy();
                selfBotsAtivos.delete(userId);
            } catch (err) {
                console.error('Erro ao desconectar:', err);
            }
        }

        // Remover do banco
        usuarios.splice(index, 1);
        salvarUsuarios();

        await message.reply(`✅ Usuário **${userTag}** removido com sucesso!`);
    }

    // !backup - Fazer backup do banco de dados
    if (command === 'backup') {
        const backupPath = path.join('/tmp', `backup-${Date.now()}.json`);
        fs.writeJsonSync(backupPath, usuarios, { spaces: 2 });
        
        await message.reply({
            content: '✅ **Backup realizado com sucesso!**',
            files: [backupPath]
        });
    }
});

// ===== INICIAR BOT PRINCIPAL =====
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN não configurado!');
    process.exit(1);
}

botPrincipal.login(BOT_TOKEN).catch(err => {
    console.error('❌ Erro no login do bot principal:', err);
    process.exit(1);
});

// ===== KEEP ALIVE =====
setInterval(() => {
    console.log(`💓 Heartbeat - Usuários: ${usuarios.length} | Online: ${selfBotsAtivos.size}`);
}, 60000);

// ===== TRATAMENTO DE ERROS =====
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});