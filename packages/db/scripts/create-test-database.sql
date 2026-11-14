-- Run once, as a Postgres superuser, against any database (for example "postgres").
-- Creates a test database with its own role. That role owns only life_optimizer_test and holds no
-- privileges on the development database, so a mistake in a test cannot damage real data.
CREATE ROLE life_optimizer_test LOGIN PASSWORD 'life_optimizer_test';
CREATE DATABASE life_optimizer_test OWNER life_optimizer_test;
-- Postgres lets everyone connect to new databases by default; close that door for the dev database.
REVOKE CONNECT ON DATABASE life_optimizer FROM PUBLIC;
