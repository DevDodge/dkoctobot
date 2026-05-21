/* eslint-disable */
import { Entity, Column, CreateDateColumn, PrimaryGeneratedColumn, Index } from 'typeorm'

@Entity()
export class SupervisorLog {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Index()
    @Column({ type: 'uuid' })
    chatflowid: string

    @Column({ type: 'varchar', nullable: true })
    chatId: string

    @Column({ type: 'varchar', nullable: true })
    sessionId: string

    @Column({ type: 'text', nullable: true })
    userInput: string

    @Column({ type: 'text', nullable: true })
    originalOutput: string

    @Column({ type: 'text', nullable: true })
    correctedOutput: string

    @Column({ type: 'text', nullable: true })
    violations: string

    @Column({ type: 'text', nullable: true })
    feedback: string

    @Column({ type: 'int', default: 1 })
    attempt: number

    @Column({ type: 'boolean', default: false })
    approved: boolean

    @Column({ type: 'float', nullable: true })
    confidence: number

    @Column({ type: 'varchar', nullable: true })
    chatflowName: string

    @Column({ type: 'timestamp' })
    @CreateDateColumn()
    createdDate: Date
}
