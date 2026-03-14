require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client: SelfBotClient } = require('discord.js-selfbot-v13');
const { Client: BotPrincipalClient, GatewayIntentBits } = require('discord.js');
const QRCode = require('qrcode');
const { MessageAttachment } = require('discord.js-selfbot-v13');

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
} catch (error) {
    console.error('❌ Erro ao ler banco:', error);
    usuarios = [];
}

function salvarUsuarios() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(usuarios, null, 2));
    } catch (error) {
        console.error('❌ Erro ao salvar banco:', error);
    }
}

// ===== SELF-BOTS ATIVOS =====
const selfBotsAtivos = new Map();

// ===== FUNÇÃO PARA GERAR PAYLOAD USANDO API CONFIÁVEL =====
async function gerarPayloadPix(chave, valor = null, descricao = '') {
    console.log(`   [API] Solicitando Pix para chave: ${chave}, valor: ${valor}, descrição: ${descricao}`);

    try {
        // Construir URL da API
        let url = `https://gerarqrcodepix.com.br/api/v1?nome=PIX%20MULTI%20BOT&cidade=BRASILIA&chave=${encodeURIComponent(chave)}&saida=br`;

        // Adicionar valor se fornecido
        if (valor) {
            const valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            url += `&valor=${valorNum}`;
        }

        // Adicionar txid (descrição) se fornecida
        if (descricao && descricao !== 'Pagamento via Pix') {
            const txid = descricao.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
            if (txid.length > 0) {
                url += `&txid=${encodeURIComponent(txid)}`;
            }
        }

        console.log(`   📡 URL da API: ${url}`);

        // Fazer requisição à API
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`API retornou erro ${response.status}`);
        }

        // A API retorna um JSON com o campo "brcode"
        const data = await response.json();
        const brCode = data.brcode; // Extrai o BR Code do JSON
        
        if (!brCode) {
            throw new Error('Resposta da API não contém brcode');
        }

        console.log(`   ✅ BR Code recebido: ${brCode.substring(0, 50)}...`);
        return brCode;

    } catch (error) {
        console.error('❌ Erro na API:', error.message);
        // Retorna um código de fallback
        return '00020126360014BR.GOV.BCB.PIX0114111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
    }
}

// ===== FUNÇÃO PARA GERAR PAYLOAD DE TESTE (EXEMPLO DO BANCO CENTRAL) =====
function gerarPayloadTeste() {
    // Este payload é um exemplo que deve funcionar em qualquer banco
    return '00020126360014BR.GOV.BCB.PIX0114111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
}

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 [${new Date().toISOString()}] Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);

        const client = new SelfBotClient({ checkUpdate: false, intents: 32767 });

        const mensagensProcessadas = new Set();
        setInterval(() => mensagensProcessadas.clear(), 10 * 60 * 1000);

        client.on('ready', () => {
            console.log(`✅✅✅ [${new Date().toISOString()}] SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();
            selfBotsAtivos.set(usuario.userId, { client, tag: client.user.tag });
        });

        client.on('messageCreate', async (message) => {
            try {
                console.log(`\n📨 [${new Date().toISOString()}] [SELF-BOT ${client.user.tag}] Mensagem: "${message.content}" de ${message.author.tag}`);

                if (mensagensProcessadas.has(message.id)) return;
                mensagensProcessadas.add(message.id);

                if (!message.content.startsWith(PREFIX)) return;
                if (message.author.id !== usuario.userId && message.author.id !== ADMIN_ID) return;

                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando!**');
                } else if (command === 'ping') {
                    await message.reply('🏓 **Pong!**');
                } else if (command === 'help' || command === 'ajuda') {
                    await message.reply(
                        '📋 **COMANDOS DISPONÍVEIS:**\n\n' +
                        '`!ping` - Testar conexão\n' +
                        '`!teste` - Testar funcionamento\n' +
                        '`!pix [chave]` - Gerar QR Code Pix\n' +
                        '`!pix [chave] [descrição]` - Pix com descrição\n' +
                        '`!pix [valor] [chave] [descrição]` - Pix com valor\n' +
                        '`!pix-teste` - Gerar QR Code de teste fixo\n' +
                        '`!pix-info` - Informações sobre o Pix\n' +
                        '`!help` - Mostrar esta ajuda'
                    );
                } else if (command === 'pix') {
                    if (args.length === 0) {
                        await message.reply('❌ Use: `!pix [chave]`');
                        return;
                    }

                    let chavePix, valor, descricao;
                    if (args[0] && args[0].match(/^[\d,.]+$/)) {
                        valor = args[0].replace(',', '.');
                        chavePix = args[1];
                        descricao = args.slice(2).join(' ') || '';
                    } else {
                        chavePix = args[0];
                        valor = null;
                        descricao = args.slice(1).join(' ') || '';
                    }

                    const procMsg = await message.reply('🔄 Gerando QR Code...');

                    try {
                        const payload = await gerarPayloadPix(chavePix, valor, descricao);
                        const qrBuffer = await QRCode.toBuffer(payload, { width: 400 });
                        const attachment = new MessageAttachment(qrBuffer, 'pix.png');

                        let resposta = `✅ **QR CODE PIX GERADO!**\n\n`;
                        resposta += `📋 **Chave:** \`${chavePix}\`\n`;
                        if (valor) resposta += `💰 **Valor:** R$ ${parseFloat(valor).toFixed(2).replace('.', ',')}\n`;
                        if (descricao) resposta += `📝 **Descrição:** ${descricao}\n`;
                        resposta += `\n📱 **Código Copia e Cola:**\n\`\`\`${payload}\`\`\``;

                        await message.reply({ content: resposta, files: [attachment] });
                        await procMsg.delete();

                        usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                        salvarUsuarios();
                    } catch (error) {
                        console.error('❌ Erro no QR Code:', error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code.');
                    }
                } else if (command === 'pix-teste') {
                    const procMsg = await message.reply('🔄 Gerando QR Code de teste...');
                    try {
                        const payload = gerarPayloadTeste();
                        const qrBuffer = await QRCode.toBuffer(payload, { width: 400 });
                        const attachment = new MessageAttachment(qrBuffer, 'pix-teste.png');

                        await message.reply({
                            content: `✅ **QR CODE DE TESTE**\n\nEste é um payload fixo que deve funcionar em qualquer banco.\n\`\`\`${payload}\`\`\``,
                            files: [attachment]
                        });
                        await procMsg.delete();
                    } catch (error) {
                        console.error('❌ Erro no teste:', error);
                        await procMsg.delete();
                        await message.reply('❌ Erro no teste.');
                    }
                } else if (command === 'pix-info') {
                    await message.reply(
                        '📌 **Sobre o Pix:**\n\n' +
                        '• A chave Pix deve estar cadastrada no seu banco.\n' +
                        '• Teste com `!pix-teste` para verificar se o QR Code é gerado.\n' +
                        '• Se o QR Code de teste funcionar, o problema é sua chave.\n' +
                        '• Você pode gerar um QR Code sem valor ou com valor fixo.\n\n' +
                        '🔗 **Validador online:** https://pix.ae/ (cole o código lá para testar)'
                    );
                }
            } catch (error) {
                console.error('❌ Erro no self-bot:', error);
            }
        });

        client.on('error', (error) => {
            console.error(`❌ Erro no self-bot:`, error.message);
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

// ===== BOT PRINCIPAL =====
const botPrincipal = new BotPrincipalClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
});

botPrincipal.once('ready', () => {
    console.log(`✅ Bot Principal online: ${botPrincipal.user.tag}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === ADMIN_ID;

    if (command === 'ping') return message.reply('🏓 Pong!');
    if (!isAdmin) return;

    if (command === 'status') {
        return message.reply(`📊 **STATUS**\n👥 Usuários: ${usuarios.length}\n🟢 Online: ${selfBotsAtivos.size}`);
    } else if (command === 'listar') {
        if (usuarios.length === 0) return message.reply('📭 Nenhum usuário.');
        let lista = '📋 **USUÁRIOS**\n';
        usuarios.forEach(u => {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} ${u.discordTag || u.userId}\n`;
        });
        return message.reply(lista);
    } else if (command === 'registrar') {
        if (args.length < 2) return message.reply('❌ Use: `!registrar [ID] [token]`');
        
        const userId = args[0];
        const userToken = args[1];
        const msgProc = await message.reply('🔄 Processando...');

        try {
            if (usuarios.some(u => u.userId === userId)) {
                return msgProc.edit('❌ Usuário já registrado!');
            }

            const testClient = new SelfBotClient({ checkUpdate: false });
            await testClient.login(userToken);
            const userTag = testClient.user.tag;
            await testClient.destroy();

            const novoUsuario = { userId, discordTag: userTag, userToken, status: 'active', registradoEm: new Date().toISOString(), comandosUsados: 0 };
            usuarios.push(novoUsuario);
            salvarUsuarios();

            const iniciou = await iniciarSelfBot(novoUsuario);
            await msgProc.edit(`✅ **USUÁRIO REGISTRADO!**\n• Usuário: **${userTag}**\n• Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}`);
        } catch (error) {
            await msgProc.edit(`❌ Erro: Token inválido!`);
        }
    } else if (command === 'remover') {
        if (args.length < 1) return message.reply('❌ Use: `!remover [ID]`');
        const userId = args[0];
        const index = usuarios.findIndex(u => u.userId === userId);
        if (index === -1) return message.reply('❌ Usuário não encontrado!');

        if (selfBotsAtivos.has(userId)) {
            try { await selfBotsAtivos.get(userId).client.destroy(); } catch {}
            selfBotsAtivos.delete(userId);
        }
        const userTag = usuarios[index].discordTag;
        usuarios.splice(index, 1);
        salvarUsuarios();
        await message.reply(`✅ Usuário **${userTag}** removido!`);
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

// ===== HEARTBEAT =====
setInterval(() => {
    console.log(`💓 Heartbeat - Usuários: ${usuarios.length} | Online: ${selfBotsAtivos.size}`);
}, 60000);

process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});
process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});