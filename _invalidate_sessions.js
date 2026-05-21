/**
 * Script to invalidate ALL active sessions in the DK-Platform.
 *
 * This script does the following:
 *   1. Clears all rows from the "login_sessions" table (express sessions).
 *   2. Rotates the JWT auth & refresh token secret files so all existing
 *      JWT cookies become invalid — forcing every user to re-login.
 *
 * After running this script, restart the server (PM2) for the new secrets
 * to take effect.
 *
 * Usage: node _invalidate_sessions.js
 */

const { Client } = require('pg')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const dbConfig = {
    host: 'localhost',
    port: 10034,
    database: 'dk_octobot',
    user: 'postgres',
    password: 'Eng.OctoBot-DK-Kareem-DODGE.12',
    ssl: false
}

// The .flowise directory where secret key files are stored
const FLOWISE_DIR = path.join('F:', 'DK-Platform', 'packages', 'server', '.flowise')

/**
 * Generate a new random secret (32 bytes, hex-encoded = 64 chars).
 */
function generateSecret() {
    return crypto.randomBytes(32).toString('hex')
}

/**
 * Rotate a secret key file by overwriting it with a new random value.
 */
function rotateSecretFile(fileName) {
    const filePath = path.join(FLOWISE_DIR, fileName)
    if (fs.existsSync(filePath)) {
        const oldValue = fs.readFileSync(filePath, 'utf8').trim()
        const newValue = generateSecret()
        fs.writeFileSync(filePath, newValue, 'utf8')
        console.log(`  ✔ Rotated: ${fileName}`)
        console.log(`    Old: ${oldValue.substring(0, 12)}...`)
        console.log(`    New: ${newValue.substring(0, 12)}...`)
        return true
    } else {
        console.log(`  ⚠ File not found: ${filePath} (skipped)`)
        return false
    }
}

async function invalidateSessions() {
    console.log('='.repeat(60))
    console.log('  DK-Platform — Invalidate All Sessions')
    console.log('='.repeat(60))
    console.log()

    // ── Step 1: Clear login_sessions table ──────────────────────
    console.log('[1/2] Clearing login_sessions table...')
    const client = new Client(dbConfig)

    try {
        await client.connect()

        // Count existing sessions
        const countResult = await client.query('SELECT COUNT(*) as count FROM login_sessions')
        const sessionCount = parseInt(countResult.rows[0].count, 10)
        console.log(`  Found ${sessionCount} active session(s).`)

        if (sessionCount > 0) {
            await client.query('DELETE FROM login_sessions')
            console.log(`  ✔ Deleted all ${sessionCount} session(s).`)
        } else {
            console.log('  ✔ No sessions to clear.')
        }
    } catch (error) {
        if (error.message.includes('does not exist')) {
            console.log('  ⚠ login_sessions table does not exist (skipped).')
        } else {
            console.error('  ✖ Database error:', error.message)
        }
    } finally {
        await client.end()
    }

    console.log()

    // ── Step 2: Rotate JWT secret files ─────────────────────────
    console.log('[2/2] Rotating JWT secret keys...')
    console.log(`  Directory: ${FLOWISE_DIR}`)
    console.log()

    const secretFiles = ['jwt_auth_token_secret.key', 'jwt_refresh_token_secret.key', 'express_session_secret.key']

    let rotated = 0
    for (const file of secretFiles) {
        if (rotateSecretFile(file)) {
            rotated++
        }
    }

    console.log()
    console.log('='.repeat(60))
    console.log(`  Done! Rotated ${rotated}/${secretFiles.length} secret(s).`)
    console.log()
    console.log('  ⚡ IMPORTANT: Restart the server for changes to take effect:')
    console.log('     pm2 restart DK-OctoBot')
    console.log()
    console.log('  All existing sessions are now invalid.')
    console.log('  Users will be forced to log in again.')
    console.log('='.repeat(60))
}

invalidateSessions()
