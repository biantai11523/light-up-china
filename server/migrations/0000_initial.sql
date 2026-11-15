CREATE TABLE `activity` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`city_id` text NOT NULL,
	`active` integer NOT NULL,
	`version` integer NOT NULL,
	`date` text NOT NULL,
	`note` text NOT NULL,
	`author` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`city_id` text PRIMARY KEY NOT NULL,
	`active` integer NOT NULL,
	`version` integer NOT NULL,
	`date` text NOT NULL,
	`note` text NOT NULL,
	`author` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_operation` text NOT NULL
);
