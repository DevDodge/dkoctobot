/* eslint-disable */
import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";

@Entity()
export class FollowUpStep {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  configId: string;

  @Index()
  @Column()
  chatflowId: string;

  @Column()
  stepOrder: number;

  @Column({ nullable: true })
  stepName: string;

  @Column()
  idleTimeout: number;

  @Column({ default: "minutes" })
  idleTimeoutUnit: string; // 'minutes' | 'hours' | 'days'

  @Column({ type: "text" })
  webhookUrl: string;

  @Column({ nullable: true, type: "text" })
  webhookHeaders: string; // JSON string

  @Column({ name: "maxfires", default: 0 })
  maxFires: number; // 0 = unlimited, 1+ = max times this step fires per session

  @Column({ type: "timestamp" })
  @CreateDateColumn()
  createdDate: Date;

  @Column({ type: "timestamp" })
  @UpdateDateColumn()
  updatedDate: Date;
}
