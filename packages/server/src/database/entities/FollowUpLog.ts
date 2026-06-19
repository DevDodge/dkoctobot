/* eslint-disable */
import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";

@Entity()
export class FollowUpLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  chatflowId: string;

  @Index()
  @Column()
  chatId: string;

  @Column({ nullable: true })
  stepId: string;

  @Column({ nullable: true })
  stepName: string;

  @Column({ nullable: true })
  stepOrder: number;

  @Column({ default: "pending" })
  status: string; // 'pending' | 'sent' | 'failed' | 'cancelled'

  @Column({ nullable: true, type: "text" })
  webhookUrl: string;

  @Column({ nullable: true, type: "text" })
  payload: string; // JSON

  @Column({ nullable: true })
  responseStatus: number;

  @Column({ nullable: true, type: "text" })
  responseBody: string;

  @Column({ nullable: true, type: "text" })
  errorMessage: string;

  @Column({ nullable: true })
  idleTimeout: number;

  @Column({ nullable: true })
  idleTimeoutUnit: string;

  @Column({ nullable: true, type: "timestamp" })
  lastMessageAt: Date;

  @Column({ nullable: true, type: "timestamp" })
  firedAt: Date;

  @Index()
  @Column({ type: "timestamp" })
  @CreateDateColumn()
  createdDate: Date;

  @Column({ default: 0 })
  retryCount: number;
}
