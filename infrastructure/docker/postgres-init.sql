-- Mirrors Neon: the database owner is NOT a superuser, it can create roles.
CREATE ROLE erp_owner LOGIN PASSWORD 'erp_owner' CREATEROLE CREATEDB;
CREATE DATABASE school_erp OWNER erp_owner;
CREATE DATABASE school_erp_test OWNER erp_owner;
