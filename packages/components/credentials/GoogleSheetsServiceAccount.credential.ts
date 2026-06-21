import { INodeParams, INodeCredential } from '../src/Interface'

class GoogleSheetsServiceAccount implements INodeCredential {
    label: string
    name: string
    version: number
    inputs: INodeParams[]
    description: string

    constructor() {
        this.label = 'Google Sheets Service Account'
        this.name = 'googleSheetsServiceAccount'
        this.version = 1.0
        this.description =
            'Service Account credentials for server-side Google Sheets access. Never expires, no re-authentication needed. Create a Service Account in Google Cloud Console and share your sheets with the service account email.'
        this.inputs = [
            {
                label: 'Service Account Key (JSON)',
                name: 'serviceAccountKey',
                type: 'json',
                description:
                    'Paste the entire contents of your Service Account JSON key file. Download from Google Cloud Console → IAM & Admin → Service Accounts.'
            }
        ]
    }
}

module.exports = { credClass: GoogleSheetsServiceAccount }
