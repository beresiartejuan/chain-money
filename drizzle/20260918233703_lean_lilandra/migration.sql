CREATE TABLE `box_access` (
	`id` text PRIMARY KEY,
	`boxId` text NOT NULL,
	`userId` text NOT NULL,
	`tokenId` text NOT NULL,
	`permissions` text NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_box_access_boxId_savings_boxes_id_fk` FOREIGN KEY (`boxId`) REFERENCES `savings_boxes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_box_access_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_box_access_tokenId_box_tokens_id_fk` FOREIGN KEY (`tokenId`) REFERENCES `box_tokens`(`id`),
	CONSTRAINT `box_access_box_user_unique` UNIQUE(`boxId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `box_tokens` (
	`id` text PRIMARY KEY,
	`boxId` text NOT NULL,
	`tokenHash` text NOT NULL UNIQUE,
	`tokenPrefix` text NOT NULL,
	`permissions` text NOT NULL,
	`status` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`redeemedAt` integer,
	`redeemedBy` text,
	CONSTRAINT `fk_box_tokens_boxId_savings_boxes_id_fk` FOREIGN KEY (`boxId`) REFERENCES `savings_boxes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_box_tokens_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_box_tokens_redeemedBy_users_id_fk` FOREIGN KEY (`redeemedBy`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY,
	`boxId` text NOT NULL,
	`type` text NOT NULL,
	`amountMinor` integer NOT NULL,
	`counterparty` text,
	`note` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_transactions_boxId_savings_boxes_id_fk` FOREIGN KEY (`boxId`) REFERENCES `savings_boxes`(`id`),
	CONSTRAINT `fk_transactions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `box_tokens_box_id_idx` ON `box_tokens` (`boxId`);--> statement-breakpoint
CREATE INDEX `transactions_box_created_at_id_idx` ON `transactions` (`boxId`,`createdAt`,`id`);