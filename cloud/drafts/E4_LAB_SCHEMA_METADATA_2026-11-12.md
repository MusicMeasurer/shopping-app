# E4 lab schema metadata · read-only snapshot · 2026-11-12

**Not a pg_dump.** Information-schema and pg_catalog inventory from shoppingapp-migration-lab; contains no user rows, auth credentials or secrets. DDL replay requires original migrations plus reviewed reconciliation. Do not execute in existing lab.

## columns

```json
[
  {
    "table_name": "item_operations",
    "column_name": "actor_id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "item_operations",
    "column_name": "operation_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "item_operations",
    "column_name": "list_id",
    "ordinal_position": 3,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "item_operations",
    "column_name": "payload_hash",
    "ordinal_position": 4,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "item_operations",
    "column_name": "result",
    "ordinal_position": 5,
    "data_type": "jsonb",
    "udt_name": "jsonb",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "item_operations",
    "column_name": "created_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "list_changes",
    "column_name": "list_id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_changes",
    "column_name": "revision",
    "ordinal_position": 2,
    "data_type": "bigint",
    "udt_name": "int8",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_changes",
    "column_name": "item_id",
    "ordinal_position": 3,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_changes",
    "column_name": "kind",
    "ordinal_position": 4,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_changes",
    "column_name": "snapshot",
    "ordinal_position": 5,
    "data_type": "jsonb",
    "udt_name": "jsonb",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_changes",
    "column_name": "created_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": "gen_random_uuid()"
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "list_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "token_hash",
    "ordinal_position": 3,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "created_by",
    "ordinal_position": 4,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "created_at",
    "ordinal_position": 5,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "expires_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "accepted_at",
    "ordinal_position": 7,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "accepted_by",
    "ordinal_position": 8,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "list_invitation_links",
    "column_name": "revoked_at",
    "ordinal_position": 9,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "list_members",
    "column_name": "list_id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_members",
    "column_name": "user_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "list_members",
    "column_name": "joined_at",
    "ordinal_position": 3,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "ownership_events",
    "column_name": "id",
    "ordinal_position": 1,
    "data_type": "bigint",
    "udt_name": "int8",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "ownership_events",
    "column_name": "list_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "ownership_events",
    "column_name": "old_owner",
    "ordinal_position": 3,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "ownership_events",
    "column_name": "new_owner",
    "ordinal_position": 4,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "ownership_events",
    "column_name": "reason",
    "ordinal_position": 5,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "ownership_events",
    "column_name": "created_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "shopping_items",
    "column_name": "id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": "gen_random_uuid()"
  },
  {
    "table_name": "shopping_items",
    "column_name": "list_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "shopping_items",
    "column_name": "name",
    "ordinal_position": 3,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "shopping_items",
    "column_name": "purchased",
    "ordinal_position": 4,
    "data_type": "boolean",
    "udt_name": "bool",
    "is_nullable": "NO",
    "column_default": "false"
  },
  {
    "table_name": "shopping_items",
    "column_name": "quantity",
    "ordinal_position": 5,
    "data_type": "numeric",
    "udt_name": "numeric",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "shopping_items",
    "column_name": "unit",
    "ordinal_position": 6,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "shopping_items",
    "column_name": "created_at",
    "ordinal_position": 7,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "shopping_items",
    "column_name": "updated_at",
    "ordinal_position": 8,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "shopping_items",
    "column_name": "deleted_at",
    "ordinal_position": 9,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "shopping_items",
    "column_name": "version",
    "ordinal_position": 10,
    "data_type": "bigint",
    "udt_name": "int8",
    "is_nullable": "NO",
    "column_default": "1"
  },
  {
    "table_name": "shopping_lists",
    "column_name": "id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": "gen_random_uuid()"
  },
  {
    "table_name": "shopping_lists",
    "column_name": "owner_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "shopping_lists",
    "column_name": "name",
    "ordinal_position": 3,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "shopping_lists",
    "column_name": "created_at",
    "ordinal_position": 4,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "shopping_lists",
    "column_name": "updated_at",
    "ordinal_position": 5,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "shopping_lists",
    "column_name": "deleted_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "shopping_lists",
    "column_name": "revision",
    "ordinal_position": 7,
    "data_type": "bigint",
    "udt_name": "int8",
    "is_nullable": "NO",
    "column_default": "0"
  },
  {
    "table_name": "siri_pairing_requests",
    "column_name": "id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": "gen_random_uuid()"
  },
  {
    "table_name": "siri_pairing_requests",
    "column_name": "owner_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_pairing_requests",
    "column_name": "list_id",
    "ordinal_position": 3,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_pairing_requests",
    "column_name": "code_hash",
    "ordinal_position": 4,
    "data_type": "bytea",
    "udt_name": "bytea",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_pairing_requests",
    "column_name": "created_at",
    "ordinal_position": 5,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "siri_pairing_requests",
    "column_name": "expires_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "(now() + '00:10:00'::interval)"
  },
  {
    "table_name": "siri_pairing_requests",
    "column_name": "consumed_at",
    "ordinal_position": 7,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_credentials",
    "column_name": "id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": "gen_random_uuid()"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "column_name": "owner_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_credentials",
    "column_name": "list_id",
    "ordinal_position": 3,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_credentials",
    "column_name": "token_hash",
    "ordinal_position": 4,
    "data_type": "bytea",
    "udt_name": "bytea",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_credentials",
    "column_name": "expires_at",
    "ordinal_position": 5,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_credentials",
    "column_name": "revoked_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_credentials",
    "column_name": "created_at",
    "ordinal_position": 7,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "siri_shortcut_operations",
    "column_name": "credential_id",
    "ordinal_position": 1,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_operations",
    "column_name": "operation_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "siri_shortcut_operations",
    "column_name": "created_at",
    "ordinal_position": 3,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "user_notifications",
    "column_name": "id",
    "ordinal_position": 1,
    "data_type": "bigint",
    "udt_name": "int8",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "user_notifications",
    "column_name": "recipient_id",
    "ordinal_position": 2,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "user_notifications",
    "column_name": "list_id",
    "ordinal_position": 3,
    "data_type": "uuid",
    "udt_name": "uuid",
    "is_nullable": "YES",
    "column_default": null
  },
  {
    "table_name": "user_notifications",
    "column_name": "event_type",
    "ordinal_position": 4,
    "data_type": "text",
    "udt_name": "text",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "user_notifications",
    "column_name": "payload",
    "ordinal_position": 5,
    "data_type": "jsonb",
    "udt_name": "jsonb",
    "is_nullable": "NO",
    "column_default": null
  },
  {
    "table_name": "user_notifications",
    "column_name": "created_at",
    "ordinal_position": 6,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "NO",
    "column_default": "now()"
  },
  {
    "table_name": "user_notifications",
    "column_name": "read_at",
    "ordinal_position": 7,
    "data_type": "timestamp with time zone",
    "udt_name": "timestamptz",
    "is_nullable": "YES",
    "column_default": null
  }
]
```

## constraints

```json
[
  {
    "table_name": "item_operations",
    "conname": "item_operations_actor_id_fkey",
    "definition": "FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE"
  },
  {
    "table_name": "item_operations",
    "conname": "item_operations_list_id_fkey",
    "definition": "FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE"
  },
  {
    "table_name": "item_operations",
    "conname": "item_operations_pkey",
    "definition": "PRIMARY KEY (actor_id, operation_id)"
  },
  {
    "table_name": "list_changes",
    "conname": "list_changes_kind_check",
    "definition": "CHECK ((kind = ANY (ARRAY['add'::text, 'update'::text, 'delete'::text])))"
  },
  {
    "table_name": "list_changes",
    "conname": "list_changes_list_id_fkey",
    "definition": "FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE"
  },
  {
    "table_name": "list_changes",
    "conname": "list_changes_pkey",
    "definition": "PRIMARY KEY (list_id, revision)"
  },
  {
    "table_name": "list_invitation_links",
    "conname": "list_invitation_links_accepted_by_fkey",
    "definition": "FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE CASCADE"
  },
  {
    "table_name": "list_invitation_links",
    "conname": "list_invitation_links_check",
    "definition": "CHECK ((expires_at > created_at))"
  },
  {
    "table_name": "list_invitation_links",
    "conname": "list_invitation_links_check1",
    "definition": "CHECK (((accepted_at IS NULL) = (accepted_by IS NULL)))"
  },
  {
    "table_name": "list_invitation_links",
    "conname": "list_invitation_links_created_by_fkey",
    "definition": "FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE"
  },
  {
    "table_name": "list_invitation_links",
    "conname": "list_invitation_links_list_id_fkey",
    "definition": "FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE"
  },
  {
    "table_name": "list_invitation_links",
    "conname": "list_invitation_links_pkey",
    "definition": "PRIMARY KEY (id)"
  },
  {
    "table_name": "list_invitation_links",
    "conname": "list_invitation_links_token_hash_key",
    "definition": "UNIQUE (token_hash)"
  },
  {
    "table_name": "list_members",
    "conname": "list_members_list_id_fkey",
    "definition": "FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE"
  },
  {
    "table_name": "list_members",
    "conname": "list_members_pkey",
    "definition": "PRIMARY KEY (list_id, user_id)"
  },
  {
    "table_name": "list_members",
    "conname": "list_members_user_id_fkey",
    "definition": "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
  },
  {
    "table_name": "ownership_events",
    "conname": "ownership_events_pkey",
    "definition": "PRIMARY KEY (id)"
  },
  {
    "table_name": "ownership_events",
    "conname": "ownership_events_reason_check",
    "definition": "CHECK ((reason = ANY (ARRAY['voluntary'::text, 'account_deletion'::text])))"
  },
  {
    "table_name": "shopping_items",
    "conname": "shopping_items_list_id_fkey",
    "definition": "FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE"
  },
  {
    "table_name": "shopping_items",
    "conname": "shopping_items_name_check",
    "definition": "CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 120)))"
  },
  {
    "table_name": "shopping_items",
    "conname": "shopping_items_pkey",
    "definition": "PRIMARY KEY (id)"
  },
  {
    "table_name": "shopping_items",
    "conname": "shopping_items_quantity_check",
    "definition": "CHECK (((quantity IS NULL) OR (quantity > (0)::numeric)))"
  },
  {
    "table_name": "shopping_items",
    "conname": "shopping_items_unit_check",
    "definition": "CHECK (((unit IS NULL) OR (char_length(unit) <= 32)))"
  },
  {
    "table_name": "shopping_items",
    "conname": "shopping_items_version_check",
    "definition": "CHECK ((version >= 1))"
  },
  {
    "table_name": "shopping_lists",
    "conname": "shopping_lists_name_check",
    "definition": "CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 120)))"
  },
  {
    "table_name": "shopping_lists",
    "conname": "shopping_lists_owner_id_fkey",
    "definition": "FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT"
  },
  {
    "table_name": "shopping_lists",
    "conname": "shopping_lists_pkey",
    "definition": "PRIMARY KEY (id)"
  },
  {
    "table_name": "shopping_lists",
    "conname": "shopping_lists_revision_check",
    "definition": "CHECK ((revision >= 0))"
  },
  {
    "table_name": "siri_pairing_requests",
    "conname": "siri_pairing_requests_code_hash_key",
    "definition": "UNIQUE (code_hash)"
  },
  {
    "table_name": "siri_pairing_requests",
    "conname": "siri_pairing_requests_list_id_fkey",
    "definition": "FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE"
  },
  {
    "table_name": "siri_pairing_requests",
    "conname": "siri_pairing_requests_owner_id_fkey",
    "definition": "FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE"
  },
  {
    "table_name": "siri_pairing_requests",
    "conname": "siri_pairing_requests_pkey",
    "definition": "PRIMARY KEY (id)"
  },
  {
    "table_name": "siri_pairing_requests",
    "conname": "siri_pairing_valid_window",
    "definition": "CHECK ((expires_at > created_at))"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "conname": "siri_shortcut_credentials_list_id_fkey",
    "definition": "FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "conname": "siri_shortcut_credentials_owner_id_fkey",
    "definition": "FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "conname": "siri_shortcut_credentials_pkey",
    "definition": "PRIMARY KEY (id)"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "conname": "siri_shortcut_credentials_token_hash_key",
    "definition": "UNIQUE (token_hash)"
  },
  {
    "table_name": "siri_shortcut_operations",
    "conname": "siri_shortcut_operations_credential_id_fkey",
    "definition": "FOREIGN KEY (credential_id) REFERENCES siri_shortcut_credentials(id) ON DELETE CASCADE"
  },
  {
    "table_name": "siri_shortcut_operations",
    "conname": "siri_shortcut_operations_pkey",
    "definition": "PRIMARY KEY (credential_id, operation_id)"
  },
  {
    "table_name": "user_notifications",
    "conname": "user_notifications_pkey",
    "definition": "PRIMARY KEY (id)"
  },
  {
    "table_name": "user_notifications",
    "conname": "user_notifications_recipient_id_fkey",
    "definition": "FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE"
  }
]
```

## indexes

```json
[
  {
    "tablename": "item_operations",
    "indexname": "item_operations_pkey",
    "indexdef": "CREATE UNIQUE INDEX item_operations_pkey ON public.item_operations USING btree (actor_id, operation_id)"
  },
  {
    "tablename": "list_changes",
    "indexname": "list_changes_pkey",
    "indexdef": "CREATE UNIQUE INDEX list_changes_pkey ON public.list_changes USING btree (list_id, revision)"
  },
  {
    "tablename": "list_invitation_links",
    "indexname": "list_invitation_links_list_idx",
    "indexdef": "CREATE INDEX list_invitation_links_list_idx ON public.list_invitation_links USING btree (list_id)"
  },
  {
    "tablename": "list_invitation_links",
    "indexname": "list_invitation_links_pkey",
    "indexdef": "CREATE UNIQUE INDEX list_invitation_links_pkey ON public.list_invitation_links USING btree (id)"
  },
  {
    "tablename": "list_invitation_links",
    "indexname": "list_invitation_links_token_hash_key",
    "indexdef": "CREATE UNIQUE INDEX list_invitation_links_token_hash_key ON public.list_invitation_links USING btree (token_hash)"
  },
  {
    "tablename": "list_members",
    "indexname": "list_members_pkey",
    "indexdef": "CREATE UNIQUE INDEX list_members_pkey ON public.list_members USING btree (list_id, user_id)"
  },
  {
    "tablename": "list_members",
    "indexname": "list_members_user_idx",
    "indexdef": "CREATE INDEX list_members_user_idx ON public.list_members USING btree (user_id)"
  },
  {
    "tablename": "ownership_events",
    "indexname": "ownership_events_pkey",
    "indexdef": "CREATE UNIQUE INDEX ownership_events_pkey ON public.ownership_events USING btree (id)"
  },
  {
    "tablename": "shopping_items",
    "indexname": "shopping_items_list_idx",
    "indexdef": "CREATE INDEX shopping_items_list_idx ON public.shopping_items USING btree (list_id, updated_at)"
  },
  {
    "tablename": "shopping_items",
    "indexname": "shopping_items_pkey",
    "indexdef": "CREATE UNIQUE INDEX shopping_items_pkey ON public.shopping_items USING btree (id)"
  },
  {
    "tablename": "shopping_lists",
    "indexname": "shopping_lists_owner_idx",
    "indexdef": "CREATE INDEX shopping_lists_owner_idx ON public.shopping_lists USING btree (owner_id)"
  },
  {
    "tablename": "shopping_lists",
    "indexname": "shopping_lists_pkey",
    "indexdef": "CREATE UNIQUE INDEX shopping_lists_pkey ON public.shopping_lists USING btree (id)"
  },
  {
    "tablename": "siri_pairing_requests",
    "indexname": "siri_pairing_owner_created",
    "indexdef": "CREATE INDEX siri_pairing_owner_created ON public.siri_pairing_requests USING btree (owner_id, created_at DESC)"
  },
  {
    "tablename": "siri_pairing_requests",
    "indexname": "siri_pairing_requests_code_hash_key",
    "indexdef": "CREATE UNIQUE INDEX siri_pairing_requests_code_hash_key ON public.siri_pairing_requests USING btree (code_hash)"
  },
  {
    "tablename": "siri_pairing_requests",
    "indexname": "siri_pairing_requests_pkey",
    "indexdef": "CREATE UNIQUE INDEX siri_pairing_requests_pkey ON public.siri_pairing_requests USING btree (id)"
  },
  {
    "tablename": "siri_shortcut_credentials",
    "indexname": "siri_shortcut_credentials_owner_idx",
    "indexdef": "CREATE INDEX siri_shortcut_credentials_owner_idx ON public.siri_shortcut_credentials USING btree (owner_id)"
  },
  {
    "tablename": "siri_shortcut_credentials",
    "indexname": "siri_shortcut_credentials_pkey",
    "indexdef": "CREATE UNIQUE INDEX siri_shortcut_credentials_pkey ON public.siri_shortcut_credentials USING btree (id)"
  },
  {
    "tablename": "siri_shortcut_credentials",
    "indexname": "siri_shortcut_credentials_token_hash_key",
    "indexdef": "CREATE UNIQUE INDEX siri_shortcut_credentials_token_hash_key ON public.siri_shortcut_credentials USING btree (token_hash)"
  },
  {
    "tablename": "siri_shortcut_operations",
    "indexname": "siri_shortcut_operations_pkey",
    "indexdef": "CREATE UNIQUE INDEX siri_shortcut_operations_pkey ON public.siri_shortcut_operations USING btree (credential_id, operation_id)"
  },
  {
    "tablename": "siri_shortcut_operations",
    "indexname": "siri_shortcut_operations_rate_idx",
    "indexdef": "CREATE INDEX siri_shortcut_operations_rate_idx ON public.siri_shortcut_operations USING btree (credential_id, created_at)"
  },
  {
    "tablename": "user_notifications",
    "indexname": "user_notifications_pkey",
    "indexdef": "CREATE UNIQUE INDEX user_notifications_pkey ON public.user_notifications USING btree (id)"
  },
  {
    "tablename": "user_notifications",
    "indexname": "user_notifications_recipient_idx",
    "indexdef": "CREATE INDEX user_notifications_recipient_idx ON public.user_notifications USING btree (recipient_id, created_at DESC)"
  }
]
```

## extensions

```json
[
  {
    "extname": "pg_net",
    "extversion": "0.20.4"
  },
  {
    "extname": "pg_stat_statements",
    "extversion": "1.11"
  },
  {
    "extname": "pgcrypto",
    "extversion": "1.3"
  },
  {
    "extname": "plpgsql",
    "extversion": "1.0"
  },
  {
    "extname": "supabase_vault",
    "extversion": "0.3.1"
  },
  {
    "extname": "uuid-ossp",
    "extversion": "1.1"
  }
]
```
