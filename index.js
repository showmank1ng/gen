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

// ===== SERVIDOR WEB (para manter o serviço ativo) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Pix Multi-Bot Online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

// ===== BANCO DE DADOS (para a Discloud, use um caminho persistente) =====
// Na Discloud, a pasta /tmp é temporária; o ideal é usar um banco externo,
// mas para simplificar, usaremos um arquivo JSON na própria pasta do bot.
const dbPath = path.join(__dirname, 'database', 'users.json');

// Garante que a pasta database existe
if (!fs.existsSync(path.join(__dirname, 'database'))) {
    fs.mkdirSync(path.join(__dirname, 'database'));
}

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
        // --- Formatar chave de telefone ---
        let chaveFormatada = chave.trim();
        // Se for apenas números e tiver 10 ou 11 dígitos, assume telefone e adiciona +55
        if (/^\d{10,11}$/.test(chaveFormatada)) {
            chaveFormatada = '+55' + chaveFormatada;
            console.log(`   📞 Chave formatada como telefone: ${chaveFormatada}`);
        }
        // Se já tiver +55 ou for e-mail, mantém

        const url = new URL('https://gerarqrcodepix.com.br/api/v1');
        url.searchParams.append('nome', 'PIX MULTI BOT');
        url.searchParams.append('cidade', 'BRASILIA');
        url.searchParams.append('chave', chaveFormatada);
        url.searchParams.append('saida', 'br');

        if (valor) {
            const valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            url.searchParams.append('valor', valorNum);
        }

        if (descricao && descricao !== 'Pagamento via Pix') {
            const txid = descricao.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
            if (txid.length > 0) {
                url.searchParams.append('txid', txid);
            }
        }

        console.log(`   📡 URL da API: ${url.toString()}`);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`API retornou erro ${response.status}`);

        const data = await response.json();
        const brCode = data.brcode;
        if (!brCode) throw new Error('Resposta da API não contém brcode');

        console.log(`   ✅ BR Code recebido: ${brCode.substring(0, 50)}...`);
        return brCode;

    } catch (error) {
        console.error('❌ Erro na API:', error.message);
        // Payload de fallback (chave 11111111111)
        return '00020126360014BR.GOV.BCB.PIX0114111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
    }
}

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 [${new Date().toISOString()}] Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);

        const client = new SelfBotClient({ checkUpdate: false, intents: 32767 });

        // Cache para evitar mensagens duplicadas (baseado no ID)
        const mensagensProcessadas = new Set();
        setInterval(() => {
            console.log(`🧹 [${client.user ? client.user.tag : 'desconhecido'}] Limpando cache de mensagens (${mensagensProcessadas.size} itens)`);
            mensagensProcessadas.clear();
        }, 10 * 60 * 1000);

        client.on('ready', () => {
            console.log(`✅✅✅ [${new Date().toISOString()}] SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();
            selfBotsAtivos.set(usuario.userId, { client, tag: client.user.tag });
        });

        client.on('messageCreate', async (message) => {
            try {
                // Log detalhado
                console.log(`\n📥 [${new Date().toISOString()}] [SELF-BOT ${client.user.tag}] Mensagem ID: ${message.id} recebida`);
                console.log(`   Autor: ${message.author.tag} (${message.author.id})`);
                console.log(`   Conteúdo: "${message.content}"`);

                // Verificação de duplicação
                if (mensagensProcessadas.has(message.id)) {
                    console.log(`   ⚠️ DUPLICATA DETECTADA! Mensagem ID ${message.id} ignorada.`);
                    return;
                }
                mensagensProcessadas.add(message.id);
                console.log(`   ✅ Mensagem ID ${message.id} registrada no cache.`);

                // Ignorar próprias mensagens
                if (message.author.id === client.user.id) {
                    console.log(`   ⏭️ Ignorando própria mensagem`);
                    return;
                }

                // Verificar prefixo
                if (!message.content.startsWith(PREFIX)) {
                    console.log(`   ⏭️ Ignorando: não começa com ${PREFIX}`);
                    return;
                }

                // Verificar se é o dono ou admin
                if (message.author.id !== usuario.userId && message.author.id !== ADMIN_ID) {
                    console.log(`   ⏭️ Ignorando: não é o dono nem o admin`);
                    return;
                }

                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                console.log(`   🎯 Comando detectado: ${command}`);

                // ===== COMANDOS =====
                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando perfeitamente!**');
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
                        '`!help` - Mostrar esta ajuda'
                    );
                } else if (command === 'pix') {
                    if (args.length === 0) {
                        await message.reply('❌ Use: `!pix [chave]` - Ex: `!pix 11999999999`');
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

                    if (!chavePix) {
                        await message.reply('❌ Chave Pix não fornecida!');
                        return;
                    }

                    console.log(`   🔑 Chave: ${chavePix}, Valor: ${valor}, Descrição: ${descricao}`);

                    const procMsg = await message.reply('🔄 **Gerando QR Code Pix...**');

                    try {
                        const payload = await gerarPayloadPix(chavePix, valor, descricao);
                        const qrBuffer = await QRCode.toBuffer(payload, { type: 'png', width: 400, margin: 2 });
                        const attachment = new MessageAttachment(qrBuffer, 'pix.png');

                        let resposta = `✅ **QR CODE PIX GERADO!**\n\n`;
                        resposta += `📋 **Chave:** \`${chavePix}\`\n`;
                        if (valor) {
                            const vf = parseFloat(valor).toFixed(2).replace('.', ',');
                            resposta += `💰 **Valor:** R$ ${vf}\n`;
                        }
                        if (descricao && descricao !== 'Pagamento via Pix') {
                            resposta += `📝 **Descrição:** ${descricao}\n`;
                        }
                        resposta += `\n📱 **Código Copia e Cola:**\n\`\`\`${payload}\`\`\``;

                        await message.reply({ content: resposta, files: [attachment] });
                        await procMsg.delete();

                        usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                        salvarUsuarios();

                        console.log(`   ✅ QR Code enviado com sucesso`);
                    } catch (error) {
                        console.error(`   ❌ Erro no QR Code:`, error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code. Tente novamente.');
                    }
                }
            } catch (error) {
                console.error('❌ Erro no processamento da mensagem:', error);
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
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
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
        return message.reply(
            `📊 **STATUS DO SISTEMA**\n\n` +
            `👥 Usuários: ${usuarios.length}\n` +
            `🟢 Online: ${selfBotsAtivos.size}\n` +
            `🔴 Offline: ${usuarios.length - selfBotsAtivos.size}`
        );
    } else if (command === 'listar') {
        if (usuarios.length === 0) return message.reply('📭 Nenhum usuário.');
        let lista = '📋 **USUÁRIOS**\n\n';
        for (const u of usuarios) {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} **${u.discordTag || u.userId}**\n`;
            if (u.comandosUsados) lista += `   └ Comandos: ${u.comandosUsados}\n`;
        }
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
                `✅ **USUÁRIO REGISTRADO!**\n` +
                `• Usuário: **${userTag}**\n` +
                `• Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}`
            );
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

// ===== TRATAMENTO DE ERROS NÃO CAPTURADOS =====
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});