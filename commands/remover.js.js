module.exports = {
    name: 'remover',
    description: 'Remove um usuário do sistema',
    async execute(message, args, context) {
        const { activeClients, usersDbPath, fs } = context;
        
        if (message.author.id !== process.env.ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode remover usuários!');
        }

        if (args.length < 1) {
            return message.reply('❌ Use: `!remover [ID_do_usuario]`');
        }

        const userId = args[0];
        const db = fs.readJsonSync(usersDbPath);
        
        const userIndex = db.users.findIndex(u => u.userId === userId);
        
        if (userIndex === -1) {
            return message.reply('❌ Usuário não encontrado!');
        }

        const userTag = db.users[userIndex].discordTag;
        
        // Remover do banco
        db.users.splice(userIndex, 1);
        fs.writeJsonSync(usersDbPath, db);
        
        // Desconectar se estiver online
        if (activeClients.has(userId)) {
            const userClient = activeClients.get(userId).client;
            await userClient.destroy();
            activeClients.delete(userId);
        }

        await message.reply(`✅ Usuário **${userTag}** removido com sucesso!`);
    }
};