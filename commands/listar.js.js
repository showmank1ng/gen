module.exports = {
    name: 'listar',
    description: 'Lista todos os usuários registrados',
    async execute(message, args, context) {
        const { activeClients, usersDbPath, fs } = context;
        
        // Verificar se é admin
        if (message.author.id !== process.env.ADMIN_ID) {
            return message.reply('❌ Apenas o administrador pode listar usuários!');
        }

        const db = fs.readJsonSync(usersDbPath);
        
        if (db.users.length === 0) {
            return message.reply('📭 Nenhum usuário registrado ainda.');
        }

        let lista = '📋 **USUÁRIOS REGISTRADOS**\n\n';
        
        db.users.forEach((user, index) => {
            const isOnline = activeClients.has(user.userId);
            const status = isOnline ? '🟢 Online' : '🔴 Offline';
            
            lista += `**${index + 1}.** ${user.discordTag}\n`;
            lista += `└ ID: \`${user.userId}\`\n`;
            lista += `└ Status: ${status}\n`;
            lista += `└ Comandos: ${user.commandsUsed || 0}\n`;
            lista += `└ Registrado: ${new Date(user.registeredAt).toLocaleDateString('pt-BR')}\n\n`;
        });

        lista += `📊 **Total:** ${db.users.length} usuários`;
        
        await message.reply(lista);
    }
};