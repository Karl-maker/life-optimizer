-- Run once, as a Postgres superuser, against any database (for example "postgres").
-- Creates a test database with its own role. That role owns only edu_service_test and holds no
-- privileges on the development database, so a mistake in a test cannot damage real data.
CREATE ROLE edu_service_test LOGIN PASSWORD 'edu_service_test';
CREATE DATABASE edu_service_test OWNER edu_service_test;
-- Postgres lets everyone connect to new databases by default; close that door for the dev database.
REVOKE CONNECT ON DATABASE edu_service FROM PUBLIC;
