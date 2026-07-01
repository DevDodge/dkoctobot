import { INodeParams, INodeCredential } from '../src/Interface'

class OctobotWappApi implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'OctobotWapp API'
        this.name = 'octobotWappApi'
        this.version = 2.0
        this.description = 'OctobotWapp WhatsApp API credentials — connects to dk.whatsdeveloper.com'
        this.inputs = [
            {
                label: 'Device UUID',
                name: 'deviceUuid',
                type: 'password',
                description: 'Your device unique identifier (X-Device-UUID)',
                placeholder: 'e.g., 11666fa0-2cbb-4b1f-b6ba-29b63fd7ed51'
            },
            {
                label: 'API Token',
                name: 'apiToken',
                type: 'password',
                description: 'Your API authentication token (X-API-Token)',
                placeholder: 'Enter your API token'
            },
            {
                label: 'Device Name',
                name: 'deviceName',
                type: 'string',
                description: 'Name of your WhatsApp device (optional)',
                placeholder: 'e.g., My WhatsApp Bot',
                optional: true
            },
            {
                label: 'API URL',
                name: 'apiUrl',
                type: 'string',
                description: 'API endpoint URL (optional)',
                placeholder: 'https://dk.whatsdeveloper.com/api/v1',
                optional: true
            }
        ]
    }
}

module.exports = { credClass: OctobotWappApi }
