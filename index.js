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
const ADMIN_ID = process.env.ADMIN_ID; // Deve ser uma string com o ID do admin

// ===== SERVIDOR WEB (keep-alive) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Pix Multi-Bot está online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
});

// ===== BANCO DE DADOS (em /tmp para o Render) =====
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
} catch (error) {
    console.error('❌ Erro ao ler banco:', error);
    usuarios = [];
}

function salvarUsuarios() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(usuarios, null, 2));
        console.log('💾 Banco de dados salvo');
    } catch (error) {
        console.error('❌ Erro ao salvar banco:', error);
    }
}

// ===== ARMAZENAR SELF-BOTS ATIVOS =====
const selfBotsAtivos = new Map(); // key: userId, value: { client, tag }

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX (simplificada) =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    try {
        // Limpar apenas números (para telefone, CPF, CNPJ)
        let chaveLimpa = chave.replace(/\D/g, '');
        // Se for email, mantém como está (contém @)
        if (chave.includes('@')) chaveLimpa = chave;
        if (!chaveLimpa) chaveLimpa = chave;

        // Construção do payload básico
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

        payload += '6304A1B2'; // CRC16 fixo (simplificado)
        return payload;
    } catch (error) {
        console.error('Erro ao gerar payload:', error);
        return null;
    }
}

// ===== FUNÇÃO PARA INICIAR UM SELF-BOT =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 [${new Date().toISOString()}] Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);

        const client = new SelfBotClient({
            checkUpdate: false,
            intents: 32767 // Todas as intents
        });

        client.on('ready', () => {
            console.log(`✅✅✅ [${new Date().toISOString()}] SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();

            selfBotsAtivos.set(usuario.userId, {
                client,
                tag: client.user.tag
            });

            // Envia uma mensagem de teste para si mesmo (opcional)
            // client.users.fetch(usuario.userId).then(user => user.send('Bot iniciado!')).catch(console.error);
        });

        // Log de todas as mensagens que chegam (sem nenhum filtro)
        client.on('messageCreate', (message) => {
            console.log(`\n📨 [${new Date().toISOString()}] [SELF-BOT ${client.user.tag}] Mensagem CRUA recebida:`);
            console.log(`   Autor: ${message.author.tag} (${message.author.id})`);
            console.log(`   Conteúdo: "${message.content}"`);
            console.log(`   Canal: ${message.channel.type}`);
            console.log(`   ID do Dono esperado: ${usuario.userId}`);

            // Ignorar próprias mensagens
            if (message.author.id === client.user.id) {
                console.log(`   ⏭️ Ignorando própria mensagem`);
                return;
            }

            // Se for do dono, responder com um simples "recebido"
            if (message.author.id === usuario.userId) {
                console.log(`   ✅ É o dono! Respondendo...`);
                message.reply('✅ Mensagem recebida pelo self-bot!').catch(console.error);
            } else {
                console.log(`   ⏭️ Não é o dono.`);
            }
        });

        client.on('error', (error) => {
            console.error(`❌ Erro no self-bot de ${usuario.discordTag}:`, error.message);
            usuario.status = 'offline';
            salvarUsuarios();
            selfBotsAtivos.delete(usuario.userId);
        });

        await client.login(usuario.userToken);
        console.log(`✅ Self-bot ${usuario.discordTag} iniciado.`);
        return true;
    } catch (error) {
        console.error(`❌ Erro ao iniciar self-bot:`, error.message);
        usuario.status = 'offline';
        salvarUsuarios();
        return false;
    }
}

// ===== INICIAR TODOS OS SELF-BOTS DO BANCO =====
function iniciarTodosSelfBots() {
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
    console.log(`👑 Admin ID configurado: ${ADMIN_ID}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === ADMIN_ID;

    // Comando público: !ping
    if (command === 'ping') {
        return message.reply('🏓 Pong!');
    }

    // Todos os demais comandos são restritos ao admin
    if (!isAdmin) {
        return message.reply('❌ Apenas o administrador pode usar este comando.');
    }

    // ===== COMANDOS DE ADMIN =====

    // !status
    if (command === 'status') {
        return message.reply(
            `📊 **STATUS DO SISTEMA**\n\n` +
            `👥 Usuários registrados: ${usuarios.length}\n` +
            `🟢 Self-bots online: ${selfBotsAtivos.size}\n` +
            `🔴 Self-bots offline: ${usuarios.length - selfBotsAtivos.size}`
        );
    }

    // !listar
    if (command === 'listar') {
        if (usuarios.length === 0) {
            return message.reply('📭 Nenhum usuário registrado.');
        }

        let lista = '📋 **USUÁRIOS REGISTRADOS**\n\n';
        for (const u of usuarios) {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} **${u.discordTag || u.userId}**\n`;
            if (u.comandosUsados) lista += `   └ Comandos: ${u.comandosUsados}\n`;
        }
        return message.reply(lista);
    }

    // !registrar
    if (command === 'registrar') {
        if (args.length < 2) {
            return message.reply('❌ Use: `!registrar [ID] [token]`');
        }

        const userId = args[0];
        const userToken = args[1];

        const msgProc = await message.reply('🔄 Processando registro...');

        try {
            // Verificar duplicidade
            if (usuarios.some(u => u.userId === userId)) {
                return msgProc.edit('❌ Este usuário já está registrado!');
            }

            // Testar token com um cliente temporário
            const testClient = new SelfBotClient({ checkUpdate: false });
            let userTag;
            try {
                await testClient.login(userToken);
                userTag = testClient.user.tag;
                await testClient.destroy();
            } catch (err) {
                return msgProc.edit('❌ Token inválido!');
            }

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

            const iniciou = await iniciarSelfBot(novoUsuario);

            await msgProc.edit(
                `✅ **USUÁRIO REGISTRADO!**\n\n` +
                `• Usuário: **${userTag}**\n` +
                `• Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}\n\n` +
                `📱 O usuário agora pode usar os comandos em QUALQUER lugar!`
            );
        } catch (error) {
            console.error('Erro no registro:', error);
            await msgProc.edit(`❌ Erro: ${error.message}`);
        }
    }

    // !remover
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
                await selfBotsAtivos.get(userId).client.destroy();
                selfBotsAtivos.delete(userId);
            } catch (err) {
                console.error('Erro ao desconectar:', err);
            }
        }

        usuarios.splice(index, 1);
        salvarUsuarios();

        await message.reply(`✅ Usuário **${userTag}** removido!`);
    }
});

// ===== INICIAR BOT PRINCIPAL =====
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN não configurado nas variáveis de ambiente!');
    process.exit(1);
}

botPrincipal.login(BOT_TOKEN).catch(err => {
    console.error('❌ Erro no login do bot principal:', err);
    process.exit(1);
});

// ===== HEARTBEAT (para manter logs ativos) =====
setInterval(() => {
    console.log(`💓 Heartbeat - Usuários: ${usuarios.length} | Online: ${selfBotsAtivos.size}`);
}, 60000);

// ===== TRATAMENTO DE ERROS NÃO CAPTURADOS =====
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});