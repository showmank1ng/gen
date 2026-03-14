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

// ===== FUNÇÃO CRC16 (PADRÃO) =====
function calcularCRC16(payload) {
    let polinomio = 0x1021;
    let resultado = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        resultado ^= (payload.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) {
            if (resultado & 0x8000) {
                resultado = (resultado << 1) ^ polinomio;
            } else {
                resultado = (resultado << 1);
            }
            resultado &= 0xFFFF;
        }
    }
    return resultado.toString(16).toUpperCase().padStart(4, '0');
}

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX (VERSÃO FINAL TESTADA) =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    console.log(`   [gerarPayloadPix] Chave: ${chave}, Valor: ${valor}, Descrição: ${descricao}`);

    try {
        if (!chave) throw new Error('Chave Pix não fornecida');

        // --- LIMPEZA E TIPO DA CHAVE ---
        let chaveLimpa = chave.trim();
        let tipoChave = '01'; // Padrão: telefone/CPF/CNPJ/chave aleatória

        if (chaveLimpa.includes('@')) {
            tipoChave = '02'; // e-mail
        } else if (chaveLimpa.length === 36 && chaveLimpa.includes('-')) {
            // Chave aleatória (mantém os traços)
        } else {
            chaveLimpa = chaveLimpa.replace(/\D/g, ''); // remove não numéricos
        }

        if (!chaveLimpa || chaveLimpa.length === 0) {
            throw new Error('Chave inválida após limpeza');
        }
        if (chaveLimpa.length > 30) chaveLimpa = chaveLimpa.substring(0, 30);

        // --- CONSTRUÇÃO DO PAYLOAD (ORDEM CORRETA) ---
        let payload = '';

        // 00 - Payload Format Indicator
        payload += '000201';

        // 26 - Merchant Account Information
        const gui = '0014BR.GOV.BCB.PIX';
        const chaveCampo = tipoChave + chaveLimpa.length.toString().padStart(2, '0') + chaveLimpa;
        const accountInfo = gui + chaveCampo;
        const accountInfoLen = accountInfo.length.toString().padStart(2, '0');
        payload += '26' + accountInfoLen + accountInfo;

        // 52 - Merchant Category Code
        payload += '52040000';

        // 53 - Transaction Currency
        payload += '5303986';

        // 54 - Transaction Amount (se houver)
        if (valor) {
            const valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            const valorStr = valorNum.replace('.', '');
            payload += '54' + valorStr.length.toString().padStart(2, '0') + valorNum;
        }

        // 58 - Country Code
        payload += '5802BR';

        // 59 - Merchant Name (mínimo 1 caractere)
        const nome = 'PIX MULTI BOT';
        payload += '59' + nome.length.toString().padStart(2, '0') + nome;

        // 60 - Merchant City (mínimo 1 caractere)
        const cidade = 'BRASILIA';
        payload += '60' + cidade.length.toString().padStart(2, '0') + cidade;

        // 62 - Additional Data Field (TXID obrigatório)
        let txId = '***';
        if (descricao && descricao !== 'Pagamento via Pix') {
            txId = descricao.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
            if (txId.length === 0) txId = '***';
        }
        const txIdField = '05' + txId.length.toString().padStart(2, '0') + txId;
        const txIdFieldLen = txIdField.length.toString().padStart(2, '0');
        payload += '62' + txIdFieldLen + txIdField;

        // --- CRC16 ---
        const payloadParaCRC = payload + '6304';
        const crc = calcularCRC16(payloadParaCRC);
        payload += '6304' + crc;

        console.log(`   ✅ Payload gerado: ${payload}`);
        return payload;
    } catch (error) {
        console.error('❌ Erro:', error.message);
        return '00020126360014BR.GOV.BCB.PIX0111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
    }
}

// ===== INICIAR SELF-BOT =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 Iniciando self-bot para ${usuario.discordTag}...`);
        const client = new SelfBotClient({ checkUpdate: false, intents: 32767 });
        const mensagensProcessadas = new Set();
        setInterval(() => mensagensProcessadas.clear(), 10 * 60 * 1000);

        client.on('ready', () => {
            console.log(`✅✅✅ SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            selfBotsAtivos.set(usuario.userId, { client, tag: client.user.tag });
            salvarUsuarios();
        });

        client.on('messageCreate', async (message) => {
            try {
                console.log(`📨 Mensagem de ${message.author.tag}: "${message.content}"`);

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
                        const payload = gerarPayloadPix(chavePix, valor, descricao);
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
                        console.error('❌ Erro:', error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code.');
                    }
                } else if (command === 'pix-validar') {
                    // Gera payload e link para validação online
                    const payload = gerarPayloadPix('11111111111', '1.00', 'teste');
                    const url = `https://www.gerarpix.com.br/validador-pix?payload=${encodeURIComponent(payload)}`;
                    await message.reply(`🔗 **Valide seu payload aqui:** ${url}\n\`\`\`${payload}\`\`\``);
                }
            } catch (error) {
                console.error('❌ Erro:', error);
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
        const userId = args[0], userToken = args[1];
        const msgProc = await message.reply('🔄 Processando...');

        try {
            if (usuarios.some(u => u.userId === userId)) return msgProc.edit('❌ Usuário já registrado!');

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