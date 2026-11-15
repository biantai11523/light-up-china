import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const visits = sqliteTable('visits', {
  cityId:text('city_id').primaryKey(), active:integer('active').notNull(), version:integer('version').notNull(),
  date:text('date').notNull(),note:text('note').notNull(),author:text('author').notNull(),updatedAt:text('updated_at').notNull(),lastOperation:text('last_operation').notNull()
});
export const activity = sqliteTable('activity', {
  operationId:text('operation_id').primaryKey(),cityId:text('city_id').notNull(),active:integer('active').notNull(),version:integer('version').notNull(),
  date:text('date').notNull(),note:text('note').notNull(),author:text('author').notNull(),updatedAt:text('updated_at').notNull()
});
export const rateLimits=sqliteTable('rate_limits',{id:text('id').primaryKey(),bucket:integer('bucket').notNull(),count:integer('count').notNull()});
