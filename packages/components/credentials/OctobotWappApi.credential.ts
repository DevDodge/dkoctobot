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
        this.version = 1.0
        this.description = 'OctobotWapp WhatsApp API credentials for sending messages'
        this.inputs = [
            {
                label: 'API Token',
                name: 'apiToken',
                type: 'password',
                description: 'Your OctobotWapp API authentication token',
                placeholder: 'Enter your API token'
            },
            {
                label: 'Device UUID',
                name: 'deviceUuid',
                type: 'string',
                description: 'Your device unique identifier',
                placeholder: 'e.g., 11666fa0-2cbb-4b1f-b6ba-29b63fd7ed51'
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
                description: 'API endpoint URL (optional, defaults to https://api.zentramsg.com/v1/messages)',
                placeholder: 'https://api.zentramsg.com/v1/messages',
                optional: true
            }
        ]
    }
}

module.exports = { credClass: OctobotWappApi }
