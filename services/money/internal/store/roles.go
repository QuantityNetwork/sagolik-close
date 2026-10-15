package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
)

// RuntimeRole is the role the service runs as. The migrations grant it
// exactly what the API needs and nothing more; it can't log in by itself.
const RuntimeRole = "money_app"

var (
	loginRoleName = regexp.MustCompile(`^[A-Za-z0-9_.@-][A-Za-z0-9_.@ -]{0,127}$`)
	entraObjectID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// EnsureRuntimeRole creates the runtime role if it doesn't exist. Run it
// before the first migration: the migrations grant their privileges to it.
func (s *Store) EnsureRuntimeRole(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `do $$ begin
		if not exists (select 1 from pg_roles where rolname = 'money_app') then create role money_app nologin; end if;
	end $$`)
	return err
}

// GrantRuntimeRole lets a login role (on Azure, the service's managed
// identity) use the runtime role's privileges.
func (s *Store) GrantRuntimeRole(ctx context.Context, login string) error {
	if !loginRoleName.MatchString(login) || login == RuntimeRole {
		return fmt.Errorf("store: unexpected login role %q", login)
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from pg_roles where rolname = $1)`, login).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("store: role %q doesn't exist; create the identity's principal first", login)
	}
	_, err := s.pool.Exec(ctx, "grant "+RuntimeRole+" to "+pgx.Identifier{login}.Sanitize())
	return err
}

// CreateEntraPrincipal creates the database role for an Azure managed
// identity by its Entra object id. Connect as the server's Entra
// administrator to the `postgres` database, where the pgaadauth functions
// live. Returns false if the role already exists.
func (s *Store) CreateEntraPrincipal(ctx context.Context, name, objectID string) (bool, error) {
	if !loginRoleName.MatchString(name) {
		return false, fmt.Errorf("store: unexpected role name %q", name)
	}
	if !entraObjectID.MatchString(objectID) {
		return false, errors.New("store: unexpected Entra object id")
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from pg_roles where rolname = $1)`, name).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	_, err := s.pool.Exec(ctx, `select * from pgaadauth_create_principal_with_oid($1, $2, 'service', false, false)`, name, objectID)
	return err == nil, err
}
