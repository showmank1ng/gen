const { AttachmentBuilder } = require('discord.js');

module.exports = {
    name: 'registrar',
    description: 'Registra um novo usuário no sistema multi-bot',
    async execute(message, args, context) {
        const { activeClients, startUserClient, usersDbPath, fs } = context;
        
        // Verificar se é admin
        if (message.author.id !== process.env.ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode registrar novos usuários!');
        }

        if (args.length < 2) {
            return message.reply(
                '❌ **Como usar:**\n' +
                '`!registrar [ID_do_usuario] [token_do_usuario]`\n\n' +
                '**Exemplo:**\n' +
                '`!registrar 123456789012345678 MTIzNDU2Nzg5MDEyMzQ1Njc4OQ==`'
            );
        }

        const userId = args[0];
        const userToken = args[1];

        try {
            // Verificar se já existe
            const db = fs.readJsonSync(usersDbPath);
            
            if (db.users.some(u => u.userId === userId)) {
                return message.reply('❌ Este usuário já está registrado!');
            }

            if (db.users.length >= parseInt(process.env.MAX_USERS || 10)) {
                return message.reply(`❌ Limite máximo de ${process.env.MAX_USERS} usuários atingido!`);
            }

            // Buscar informações do usuário (testar token)
            const { Client } = require('discord.js-selfbot-v13');
            const testClient = new Client({ checkUpdate: false });
            
            let userTag = 'Desconhecido';
            
            try {
                await testClient.login(userToken);
                userTag = testClient.user.tag;
                await testClient.destroy();
            } catch (error) {
                return message.reply('❌ Token inválido ou expirado!');
            }

            // Salvar no banco de dados
            const newUser = {
                userId,
                discordTag: userTag,
                userToken,
                status: 'active',
                registeredAt: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
                commandsUsed: 0
            };

            db.users.push(newUser);
            fs.writeJsonSync(usersDbPath, db);

            // Iniciar cliente do usuário
            const started = await startUserClient(newUser);
            
            if (started) {
                await message.reply(`✅ **Usuário registrado com sucesso!**\n\n` +
                                   `📋 **Detalhes:**\n` +
                                   `• Usuário: ${userTag}\n` +
                                   `• ID: ${userId}\n` +
                                   `• Status: Online 🟢`);
            } else {
                await message.reply(`⚠️ **Usuário registrado mas falhou ao iniciar!**\n` +
                                   `Verifique o token manualmente.`);
            }

        } catch (error) {
            console.error('Erro no registro:', error);
            await message.reply('❌ Erro ao registrar usuário');
        }
    }
};