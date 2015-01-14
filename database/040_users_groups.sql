
drop table if exists users_groups cascade;

create table users_groups(
	id         serial,
	user_id    int references users(id)    on update cascade on delete cascade,
	group_code int references groups(code) on update cascade on delete cascade,
	primary key(user_id, group_code)
);
SELECT audit.audit_table('users_groups');

-- todo: create index?