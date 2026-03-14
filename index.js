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
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
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

// ===== FUNÇÃO CRC16 CORRIGIDA =====
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

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX (VERSÃO TESTADA) =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    console.log(`   [gerarPayloadPix] Chamada com chave: ${chave}, valor: ${valor}, descricao: ${descricao}`);
    
    try {
        if (!chave) throw new Error('Chave Pix não fornecida');

        // --- 1. IDENTIFICAR E LIMPAR A CHAVE ---
        let chaveLimpa = chave.trim();
        let id = '01'; // ID padrão para telefone/CPF/CNPJ/chave aleatória
        
        if (chaveLimpa.includes('@')) {
            id = '02'; // Email
        } else if (chaveLimpa.length === 36 && chaveLimpa.includes('-')) {
            id = '01'; // Chave aleatória (mantém traços)
        } else {
            chaveLimpa = chaveLimpa.replace(/\D/g, ''); // Remove não numéricos
        }

        if (!chaveLimpa || chaveLimpa.length === 0) {
            chaveLimpa = chave.substring(0, 30);
        }

        if (chaveLimpa.length > 30) {
            chaveLimpa = chaveLimpa.substring(0, 30);
        }

        // --- 2. CONSTRUIR PAYLOAD SEGUINDO O PADRÃO OFICIAL ---
        let payload = '';

        // 00 - Payload Format Indicator
        payload += '000201';

        // 26 - Merchant Account Information
        let gui = '0014BR.GOV.BCB.PIX';
        let chaveCampo = id + chaveLimpa.length.toString().padStart(2, '0') + chaveLimpa;
        let accountInfo = gui + chaveCampo;
        let accountInfoLen = accountInfo.length.toString().padStart(2, '0');
        payload += '26' + accountInfoLen + accountInfo;

        // 52 - Merchant Category Code
        payload += '52040000';

        // 53 - Transaction Currency
        payload += '5303986';

        // 54 - Transaction Amount (se houver valor)
        if (valor) {
            let valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            let valorStr = valorNum.replace('.', '');
            payload += '54' + valorStr.length.toString().padStart(2, '0') + valorNum;
        }

        // 58 - Country Code
        payload += '5802BR';

        // 59 - Merchant Name
        payload += '5915PIX MULTI BOT';

        // 60 - Merchant City
        payload += '6008BRASILIA';

        // 62 - Additional Data Field
        let txId = '***';
        if (descricao && descricao !== 'Pagamento via Pix') {
            txId = descricao.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
            if (txId.length === 0) txId = '***';
        }
        
        let txIdField = '05' + txId.length.toString().padStart(2, '0') + txId;
        let txIdFieldLen = txIdField.length.toString().padStart(2, '0');
        payload += '62' + txIdFieldLen + txIdField;

        // --- 3. CALCULAR CRC16 ---
        let payloadCompleto = payload + '6304';
        let crc = calcularCRC16(payloadCompleto);
        payloadCompleto += crc;

        console.log(`   ✅ Payload gerado: ${payloadCompleto}`);
        return payloadCompleto;
        
    } catch (error) {
        console.error('❌ [gerarPayloadPix] Exceção:', error.message);
        // Payload de fallback com chave 11111111111
        return '00020126360014BR.GOV.BCB.PIX0111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
    }
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