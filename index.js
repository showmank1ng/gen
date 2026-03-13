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
        console.log(`🔄 Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);

        const client = new SelfBotClient({
            checkUpdate: false,
            intents: 32767 // Todas as intents (essencial para receber mensagens)
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

            console.log(`🎯 ${client.user.tag} aguardando comandos...`);
        });

        // Evento para mensagens (RAW) – isso sempre logará, independente de filtros
        client.on('messageCreate', async (message) => {
            // Log bruto para debug (aparece no Render)
            console.log(`\n📨 [RAW] ${client.user.tag} recebeu:`);
            console.log(`   Autor: ${message.author.tag} (${message.author.id})`);
            console.log(`   Conteúdo: "${message.content}"`);
            console.log(`   Canal: ${message.channel.type}`);

            try {
                // 1. Ignorar mensagens do próprio bot
                if (message.author.id === client.user.id) return;

                // 2. Verificar se é o dono da conta
                if (message.author.id !== usuario.userId) {
                    console.log(`   ⏭️ Ignorado: não é o dono da conta.`);
                    return;
                }

                console.log(`   ✅ Dono da conta identificado.`);

                // 3. Verificar prefixo
                if (!message.content.startsWith(PREFIX)) {
                    console.log(`   ⏭️ Ignorado: não começa com ${PREFIX}`);
                    return;
                }

                // 4. Processar comando
                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                console.log(`   🎯 Comando: ${command}`);

                // Comando !ping
                if (command === 'ping') {
                    await message.reply('🏓 **Pong!**');
                    console.log(`   ✅ Ping respondido`);
                }

                // Comando !teste
                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando perfeitamente!**');
                    console.log(`   ✅ Teste respondido`);
                }

                // Comando !help
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

                // Comando !pix
                if (command === 'pix') {
                    console.log(`   🎯 Executando PIX`);

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

                    // Verificar se o primeiro argumento é um valor (ex: 50.00)
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

                    console.log(`   🔑 Chave: ${chavePix}`);
                    if (valor) console.log(`   💰 Valor: ${valor}`);
                    if (descricao) console.log(`   📝 Descrição: ${descricao}`);

                    const procMsg = await message.reply('🔄 **Gerando QR Code Pix...**');

                    try {
                        const payload = gerarPayloadPix(chavePix, valor, descricao);
                        if (!payload) throw new Error('Payload inválido');

                        const qrBuffer = await QRCode.toBuffer(payload, { width: 400, margin: 2 });
                        const attachment = new AttachmentBuilder(qrBuffer, { name: 'pix.png' });

                        let resposta = `✅ **QR CODE PIX GERADO!**\n\n`;
                        resposta += `📋 **Detalhes:**\n`;
                        resposta += `• Chave: \`${chavePix}\`\n`;
                        if (valor) {
                            const vf = parseFloat(valor).toFixed(2).replace('.', ',');
                            resposta += `• Valor: R$ ${vf}\n`;
                        }
                        if (descricao && descricao !== 'Pagamento via Pix') {
                            resposta += `• Descrição: ${descricao}\n`;
                        }
                        resposta += `\n📱 **Código Pix Copia e Cola:**\n\`\`\`${payload}\`\`\``;

                        await message.reply({ content: resposta, files: [attachment] });
                        await procMsg.delete();

                        // Atualizar contador
                        usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                        salvarUsuarios();

                        console.log(`   ✅ QR Code enviado com sucesso`);
                    } catch (err) {
                        console.error(`   ❌ Erro no QR Code:`, err);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code. Tente novamente.');
                    }
                }
            } catch (error) {
                console.error('❌ Erro ao processar mensagem:', error);
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