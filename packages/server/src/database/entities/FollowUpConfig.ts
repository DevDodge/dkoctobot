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
export class FollowUpConfig {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  chatflowId: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ default: true })
  includeSessionDetails: boolean;

  @Column({ default: 10 })
  maxMessages: number;

  @Column({ type: "text", nullable: true })
  chatIdFilterRegex: string;

  @Column({ type: "timestamp" })
  @CreateDateColumn()
  createdDate: Date;

  @Column({ type: "timestamp" })
  @UpdateDateColumn()
  updatedDate: Date;
}
