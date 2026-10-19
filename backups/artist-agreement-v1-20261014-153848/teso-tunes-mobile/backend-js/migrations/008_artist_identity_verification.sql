-- Additive artist identity-verification evidence for the existing application workflow.
-- Existing applications and approved artists remain active and default to unverified.
begin;

do $$ begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'Migration 008 requires a trusted database owner, not an API role';
  end if;
end $$;

alter table tesohub_music.artist_applications
  add column verification_status text not null default 'unverified'
    check (verification_status in (
      'unverified',
      'verification_pending',
      'verified',
      'additional_information_required'
    )),
  add column verification_method text not null default ''
    check (verification_method in ('', 'social_challenge', 'account_history', 'other')),
  add column verification_result text not null default ''
    check (verification_result in (
      '',
      'challenge_issued',
      'passed',
      'failed',
      'needs_more_information'
    )),
  add column verification_reviewed_at timestamptz,
  add column verification_reviewed_by text not null default '',
  add column verification_notes text not null default '',
  add column social_challenge_code_hash text
    check (
      social_challenge_code_hash is null
      or social_challenge_code_hash ~ '^[0-9a-f]{64}$'
    ),
  add column social_challenge_issued_at timestamptz,
  add column social_challenge_completed_at timestamptz;

create index artist_applications_verification_status_idx
  on tesohub_music.artist_applications (verification_status, id desc);

commit;
