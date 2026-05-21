/**
 * Script to change the password for a user in the DK-Platform database.
 *
 * Usage: node _change_password.js
 */

const bcrypt = require('bcryptjs')
const { Client } = require('pg')

const EMAIL = 'octobotchatbot@gmail.com'
const NEW_PASSWORD = 'Eng.DK.OctoBot.Dodge.Kareem.12'
const SALT_ROUNDS = 10

const dbConfig = {
    host: 'localhost',
    port: 10034,
    database: 'dk_octobot',
    user: 'postgres',
    password: 'Eng.OctoBot-DK-Kareem-DODGE.12',
    ssl: false
}

async function changePassword() {
    const client = new Client(dbConfig)

    try {
        await client.connect()
        console.log('Connected to database.')

        // Check if user exists
        const userResult = await client.query('SELECT id, email, name FROM "user" WHERE email = $1', [EMAIL])

        if (userResult.rows.length === 0) {
            console.error(`User with email "${EMAIL}" not found!`)
            process.exit(1)
        }

        const user = userResult.rows[0]
        console.log(`Found user: ${user.name} (${user.email}) [ID: ${user.id}]`)

        // Hash the new password
        const salt = bcrypt.genSaltSync(SALT_ROUNDS)
        const hashedPassword = bcrypt.hashSync(NEW_PASSWORD, salt)
        console.log('New password hashed successfully.')

        // Update the password in the database
        await client.query('UPDATE "user" SET credential = $1 WHERE email = $2', [hashedPassword, EMAIL])

        console.log(`\nPassword updated successfully for: ${EMAIL}`)
        console.log(`New password: ${NEW_PASSWORD}`)
    } catch (error) {
        console.error('Error:', error.message)
        process.exit(1)
    } finally {
        await client.end()
        console.log('\nDatabase connection closed.')
    }
}

changePassword()
