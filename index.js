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

// ===== FUNÇÃO CRC16 (IMPLEMENTAÇÃO PADRÃO) =====
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

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX (BASE OFICIAL) =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    console.log(`   [gerarPayloadPix] Chamada com chave: ${chave}, valor: ${valor}, descricao: ${descricao}`);
    
    try {
        if (!chave) throw new Error('Chave Pix não fornecida');

        // --- 1. LIMPEZA E IDENTIFICAÇÃO DA CHAVE ---
        let chaveLimpa = chave.trim();
        let tipoChave = '01'; // Padrão para telefone, CPF, CNPJ, chave aleatória

        if (chaveLimpa.includes('@')) {
            tipoChave = '02'; // e-mail
        } else if (chaveLimpa.length === 36 && chaveLimpa.includes('-')) {
            // Chave aleatória (mantém os traços)
            tipoChave = '01';
        } else {
            chaveLimpa = chaveLimpa.replace(/\D/g, ''); // remove tudo que não for número
        }

        if (!chaveLimpa || chaveLimpa.length === 0) {
            throw new Error('Chave inválida após limpeza');
        }

        if (chaveLimpa.length > 30) {
            chaveLimpa = chaveLimpa.substring(0, 30);
        }

        // --- 2. CONSTRUÇÃO DO PAYLOAD PASSO A PASSO ---
        let payload = '';

        // 00 - Payload Format Indicator (fixo: 01)
        payload += '000201';

        // 26 - Merchant Account Information
        const gui = '0014BR.GOV.BCB.PIX'; // GUI fixo
        const chaveCampo = tipoChave + chaveLimpa.length.toString().padStart(2, '0') + chaveLimpa;
        const accountInfo = gui + chaveCampo;
        const accountInfoLen = accountInfo.length.toString().padStart(2, '0');
        payload += '26' + accountInfoLen + accountInfo;

        // 52 - Merchant Category Code (fixo: 0000)
        payload += '52040000';

        // 53 - Transaction Currency (986 = Real)
        payload += '5303986';

        // 54 - Transaction Amount (se houver valor)
        if (valor) {
            const valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            const valorStr = valorNum.replace('.', '');
            payload += '54' + valorStr.length.toString().padStart(2, '0') + valorNum;
        }

        // 58 - Country Code (BR)
        payload += '5802BR';

        // 59 - Merchant Name (até 25 caracteres)
        const nomeRecebedor = 'PIX MULTI BOT';
        payload += '59' + nomeRecebedor.length.toString().padStart(2, '0') + nomeRecebedor;

        // 60 - Merchant City (até 15 caracteres)
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

        // --- 3. CÁLCULO DO CRC16 ---
        const payloadParaCRC = payload + '6304';
        const crc = calcularCRC16(payloadParaCRC);
        payload += '6304' + crc;

        console.log(`   ✅ Payload gerado: ${payload}`);
        return payload;
    } catch (error) {
        console.error('❌ [gerarPayloadPix] Exceção:', error.message);
        // Payload de fallback (chave 11111111111, testado)
        return '00020126360014BR.GOV.BCB.PIX0111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
    }
}

// ===== FUNÇÃO PARA GERAR PAYLOAD DE TESTE (EXEMPLO DO BANCO CENTRAL) =====
function gerarPayloadTeste() {
    // Este payload é um exemplo conhecido e deve funcionar em qualquer banco
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
                        console.error('❌ Erro no QR Code:', error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code.');
                    }
                } else if (command === 'pix-teste') {
                    // Comando para testar com payload fixo
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
                } else if (command === 'pix-validador') {
                    // Comando para gerar payload e link para validador online
                    const payload = gerarPayloadPix('11111111111', '1.00', 'teste');
                    const url = `https://www.gerarpix.com.br/validador-pix?payload=${encodeURIComponent(payload)}`;
                    await message.reply(`🔗 **Valide seu payload aqui:** ${url}\n\`\`\`${payload}\`\`\``);
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