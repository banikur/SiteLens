--
-- PostgreSQL database dump
--

\restrict iLycuyXrfk3HggYQaWen9eSb7aoiagnj6Xuf8ymXznavzDgQ5IGvWTvWPgb3ocU

-- Dumped from database version 14.19
-- Dumped by pg_dump version 14.19

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_name text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: checklist_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checklist_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    version text DEFAULT '1.0'::text NOT NULL,
    standard_body text DEFAULT 'Custom'::text NOT NULL,
    standard_code text,
    document_control_no text,
    project_id uuid,
    target_role text,
    requires_approval boolean DEFAULT false NOT NULL,
    approval_role text,
    workflow_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    estimated_minutes integer DEFAULT 20 NOT NULL,
    sections jsonb DEFAULT '[]'::jsonb NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_master_template boolean DEFAULT false NOT NULL,
    author_id uuid,
    author_name text NOT NULL,
    author_role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.checklist_templates OWNER TO postgres;

--
-- Name: corrective_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.corrective_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid,
    inspection_title text NOT NULL,
    project_id uuid NOT NULL,
    project_name text NOT NULL,
    site_zone text NOT NULL,
    field_label text NOT NULL,
    issue_description text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    assignee_id uuid,
    assigned_to_name text NOT NULL,
    assigned_to_role text NOT NULL,
    due_date text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolution_notes text,
    evidence_photo_url text
);


ALTER TABLE public.corrective_actions OWNER TO postgres;

--
-- Name: daily_weather_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.daily_weather_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    log_date date NOT NULL,
    rain_hours numeric(4,2) DEFAULT 0.00 NOT NULL,
    weather_condition text DEFAULT 'Clear'::text NOT NULL,
    is_work_halted boolean DEFAULT false NOT NULL,
    impact_notes text,
    recorded_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.daily_weather_logs OWNER TO postgres;

--
-- Name: evidence_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.evidence_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid,
    file_url text NOT NULL,
    attachment_type text DEFAULT 'photo'::text NOT NULL,
    sha256 text NOT NULL,
    size_bytes integer,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    uploader_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.evidence_attachments OWNER TO postgres;

--
-- Name: inspection_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inspection_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stage_id uuid NOT NULL,
    attempt_number integer DEFAULT 1 NOT NULL,
    submitter_id uuid NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    approver_id uuid,
    decided_at timestamp with time zone,
    status text DEFAULT 'submitted'::text NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    rejection_reason text,
    signature_canvas_url text,
    wet_signature_document_url text,
    offline_sync_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.inspection_attempts OWNER TO postgres;

--
-- Name: inspections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_mutation_id text,
    template_id uuid NOT NULL,
    template_title text NOT NULL,
    category text NOT NULL,
    project_id uuid NOT NULL,
    project_name text NOT NULL,
    site_zone text NOT NULL,
    inspector_id uuid NOT NULL,
    inspector_name text NOT NULL,
    inspector_role text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    current_step_index integer DEFAULT 0 NOT NULL,
    approval_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    evidence_photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    signature_data jsonb,
    score_percent integer DEFAULT 0 NOT NULL,
    passed_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    non_applicable_count integer DEFAULT 0 NOT NULL,
    notes text,
    submitted_at timestamp with time zone,
    reviewed_by text,
    reviewed_role text,
    reviewed_at timestamp with time zone,
    review_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.inspections OWNER TO postgres;

--
-- Name: notification_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification_settings (
    id text NOT NULL,
    smtp_host text,
    smtp_port integer DEFAULT 587,
    smtp_user text,
    smtp_pass text,
    smtp_from text,
    webhook_url text,
    webhook_type text DEFAULT 'generic'::text
);


ALTER TABLE public.notification_settings OWNER TO postgres;

--
-- Name: planned_curve_overrides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.planned_curve_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    week_index integer NOT NULL,
    planned_cumulative_percent numeric(5,2) NOT NULL,
    justification text NOT NULL,
    overridden_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.planned_curve_overrides OWNER TO postgres;

--
-- Name: project_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.project_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_role text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.project_members OWNER TO postgres;

--
-- Name: projects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    client text NOT NULL,
    location text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    zones jsonb DEFAULT '[]'::jsonb NOT NULL,
    lead_manager text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.projects OWNER TO postgres;

--
-- Name: punchlist_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.punchlist_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    attempt_id uuid,
    issue_description text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    creator_id uuid NOT NULL,
    assignee_id uuid,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.punchlist_items OWNER TO postgres;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: tenant_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tenant_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    facility_location text NOT NULL,
    workforce_count integer DEFAULT 50 NOT NULL,
    risk_level text DEFAULT 'HIGH'::text NOT NULL,
    target_smk3_level text DEFAULT 'AWAL_64'::text NOT NULL,
    chemical_hazard_status text DEFAULT 'NON_BAHAYA'::text NOT NULL,
    chemical_inventory jsonb DEFAULT '[]'::jsonb NOT NULL,
    major_hazard_doc_uploaded boolean DEFAULT false NOT NULL,
    ahli_k3_kimia_count integer DEFAULT 0 NOT NULL,
    petugas_k3_kimia_count integer DEFAULT 0 NOT NULL,
    last_chemical_inspection_date timestamp with time zone,
    next_emergency_drill_date timestamp with time zone,
    expiry_alert_days integer DEFAULT 60 NOT NULL,
    smk3_elements_map jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tenant_profiles OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    pin_hash text,
    role text NOT NULL,
    title text NOT NULL,
    avatar text DEFAULT ''::text NOT NULL,
    assigned_projects jsonb DEFAULT '[]'::jsonb NOT NULL,
    certifications jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: webauthn_credentials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    counter integer DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    device_name text DEFAULT 'Registered Device'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.webauthn_credentials OWNER TO postgres;

--
-- Name: work_nodes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.work_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    parent_id uuid,
    wbs_code text NOT NULL,
    name text NOT NULL,
    weight_percent numeric(5,2) DEFAULT 0.00 NOT NULL,
    planned_start_date timestamp with time zone,
    planned_end_date timestamp with time zone,
    document_reference_no text,
    active_revision text,
    claimed_progress_percent integer DEFAULT 0 NOT NULL,
    verified_progress_percent integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.work_nodes OWNER TO postgres;

--
-- Name: work_stages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.work_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    stage_order integer DEFAULT 1 NOT NULL,
    stage_type text DEFAULT 'work'::text NOT NULL,
    name text NOT NULL,
    assigned_role text NOT NULL,
    approval_role text,
    checklist_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    requires_wet_signature boolean DEFAULT false NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    actual_completed_at timestamp with time zone,
    forecast_completion_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.work_stages OWNER TO postgres;

--
-- Name: work_workflows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.work_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.work_workflows OWNER TO postgres;

--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, metadata, created_at) FROM stdin;
3a304c87-fc6d-4ce5-be35-1ea4ef94689c	\N	Site Engineer A	UPDATE_WBS_NODE	work_node	11111111-1111-4111-8111-222222222222	{"name": "Substructure & Foundation", "wbsCode": "1.1", "parentId": null, "sortOrder": 10}	2026-11-22 22:10:57.297727+07
13920ad3-e98d-4dc0-854c-eb85245ec09a	\N	Site Engineer A	UPDATE_WBS_NODE	work_node	11111111-1111-4111-8111-222222222222	{"name": "Substructure & Foundation", "wbsCode": "1.1", "parentId": "22222222-1111-4111-8111-111111111111", "sortOrder": 10}	2026-11-22 22:10:57.269937+07
2956e41b-ea35-478c-9358-4cc4b17cb615	\N	QAQC Lead A	REVIEW_STAGE_INSPECTION	work_stage	44444444-1111-4111-8111-111111111111	{"decision": "approved", "attemptId": "55555555-1111-4111-8111-111111111111", "stageName": "Reinforcement & Concrete Hold Point"}	2026-11-22 22:10:57.407461+07
f5ed508c-2e11-4edb-b4bc-73a8d326c89a	\N	QAQC Lead A	REVIEW_STAGE_INSPECTION	work_stage	44444444-1111-4111-8111-111111111111	{"decision": "rejected", "attemptId": "55555555-1111-4111-8111-111111111111", "stageName": "Reinforcement & Concrete Hold Point"}	2026-11-22 22:10:57.436085+07
\.


--
-- Data for Name: checklist_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.checklist_templates (id, title, category, description, version, standard_body, standard_code, document_control_no, project_id, target_role, requires_approval, approval_role, workflow_steps, estimated_minutes, sections, tags, is_master_template, author_id, author_name, author_role, created_at, updated_at) FROM stdin;
b8888888-8888-4888-8888-888888888888	Master Generic Template	Safety & HSE	Master checklist for all	1.0	Custom	\N	\N	\N	\N	f	\N	[]	20	[]	[]	t	\N	Admin	Project Director & Tenant Admin	2026-11-22 22:10:57.799385+07	2026-11-22 22:10:57.799385+07
b7777777-7777-4777-8777-777777777777	Project B Proprietary Template	Civil & Structural	Only for Project B	1.0	Custom	\N	\N	22222222-2222-4222-8222-222222222222	\N	f	\N	[]	20	[]	[]	f	\N	User B	QA/QC Lead / Owner Inspector	2026-11-22 22:10:57.799385+07	2026-11-22 22:10:57.799385+07
\.


--
-- Data for Name: corrective_actions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.corrective_actions (id, inspection_id, inspection_title, project_id, project_name, site_zone, field_label, issue_description, severity, assignee_id, assigned_to_name, assigned_to_role, due_date, status, created_at, resolved_at, resolution_notes, evidence_photo_url) FROM stdin;
b6666666-6666-4666-8666-666666666666	b5555555-5555-4555-8555-555555555555	Project B Proprietary Template	22222222-2222-4222-8222-222222222222	Project Beta	Zone B1	Defect in Beta	Concrete honeycomb in Zone B1	critical	\N	Subcon Beta	Action Owner / Subcontractor	2026-12-01	OPEN	2026-11-22 22:10:57.816109+07	\N	\N	\N
\.


--
-- Data for Name: daily_weather_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.daily_weather_logs (id, project_id, log_date, rain_hours, weather_condition, is_work_halted, impact_notes, recorded_by_id, created_at) FROM stdin;
\.


--
-- Data for Name: evidence_attachments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.evidence_attachments (id, attempt_id, file_url, attachment_type, sha256, size_bytes, captured_at, uploader_id, created_at) FROM stdin;
\.


--
-- Data for Name: inspection_attempts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inspection_attempts (id, stage_id, attempt_number, submitter_id, submitted_at, approver_id, decided_at, status, answers, rejection_reason, signature_canvas_url, wet_signature_document_url, offline_sync_id, created_at) FROM stdin;
b4444444-4444-4444-8444-444444444444	b3333333-3333-4333-8333-333333333333	1	bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb	2026-11-22 22:10:57.811701+07	\N	\N	submitted	{"specCompliance": "PASS"}	\N	\N	\N	\N	2026-11-22 22:10:57.811701+07
\.


--
-- Data for Name: inspections; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inspections (id, client_mutation_id, template_id, template_title, category, project_id, project_name, site_zone, inspector_id, inspector_name, inspector_role, status, current_step_index, approval_history, answers, evidence_photos, signature_data, score_percent, passed_count, failed_count, non_applicable_count, notes, submitted_at, reviewed_by, reviewed_role, reviewed_at, review_notes, created_at) FROM stdin;
b5555555-5555-4555-8555-555555555555	\N	b7777777-7777-4777-8777-777777777777	Project B Proprietary Template	Civil & Structural	22222222-2222-4222-8222-222222222222	Project Beta	Zone B1	bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb	User B	QA/QC Lead / Owner Inspector	submitted	0	[]	{}	[]	\N	0	0	0	0	\N	\N	\N	\N	\N	\N	2026-11-22 22:10:57.814146+07
\.


--
-- Data for Name: notification_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.notification_settings (id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, webhook_url, webhook_type) FROM stdin;
\.


--
-- Data for Name: planned_curve_overrides; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.planned_curve_overrides (id, project_id, week_index, planned_cumulative_percent, justification, overridden_by_id, created_at) FROM stdin;
\.


--
-- Data for Name: project_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.project_members (id, project_id, user_id, project_role, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.projects (id, name, code, client, location, status, zones, lead_manager, created_at) FROM stdin;
11111111-1111-4111-8111-111111111111	Project Alpha	PRJ-AAA	Client Alpha	Site A	active	[{"id": "z1", "name": "Zone A1", "description": "Zone A desc", "safetyLevel": "Standard"}]	Manager A	2026-11-22 22:10:57.719774+07
22222222-2222-4222-8222-222222222222	Project Beta	PRJ-BBB	Client Beta	Site B	active	[{"id": "z2", "name": "Zone B1", "description": "Zone B desc", "safetyLevel": "High Risk"}]	Manager B	2026-11-22 22:10:57.719774+07
\.


--
-- Data for Name: punchlist_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.punchlist_items (id, node_id, stage_id, attempt_id, issue_description, severity, creator_id, assignee_id, status, created_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (id, user_id, expires_at, created_at) FROM stdin;
40098f4246a406daa095a9933b719a7e8bc851b69d901459907d729a39f4f85e	aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa	2026-11-23 22:10:57.794+07	2026-11-22 22:10:57.79674+07
80250871401e8fa7f0fc2b0635a9dc9601af665195bb5c9f89cb80b0776b97d0	bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb	2026-11-23 22:10:57.794+07	2026-11-22 22:10:57.79674+07
94482c7381169e4f853447d1dee809a03e86d62be99e77a7d7c7786f2be9dd5d	dddddddd-dddd-4ddd-8ddd-dddddddddddd	2026-11-23 22:10:57.794+07	2026-11-22 22:10:57.79674+07
fa44c75fc2b49f427ddba18a2bb90913cf39c11e40f384590d0f92afd1e7605b	cccccccc-cccc-4ccc-8ccc-cccccccccccc	2026-11-23 22:10:57.794+07	2026-11-22 22:10:57.79674+07
\.


--
-- Data for Name: tenant_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tenant_profiles (id, company_name, facility_location, workforce_count, risk_level, target_smk3_level, chemical_hazard_status, chemical_inventory, major_hazard_doc_uploaded, ahli_k3_kimia_count, petugas_k3_kimia_count, last_chemical_inspection_date, next_emergency_drill_date, expiry_alert_days, smk3_elements_map, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, name, email, password_hash, pin_hash, role, title, avatar, assigned_projects, certifications, is_active, created_at) FROM stdin;
aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa	user_a	Inspector User A	user_a@test.com	72dfd5faf944b537e2f5d111055abb18:8d9158f53577cf5884d6edbc58cfa1db961be1534c2b2b4d64f37d4b0a3ef0fcafcb4df1f6809d00205b896d61a126c5ecf0b087e31a35865b0e4b6297be7316	\N	Field / QC Inspector	Site QC Inspector		["11111111-1111-4111-8111-111111111111"]	[]	t	2026-11-22 22:10:57.792141+07
bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb	user_b	QAQC Lead User B	user_b@test.com	72dfd5faf944b537e2f5d111055abb18:8d9158f53577cf5884d6edbc58cfa1db961be1534c2b2b4d64f37d4b0a3ef0fcafcb4df1f6809d00205b896d61a126c5ecf0b087e31a35865b0e4b6297be7316	\N	QA/QC Lead / Owner Inspector	QA Lead		["22222222-2222-4222-8222-222222222222"]	[]	t	2026-11-22 22:10:57.792141+07
dddddddd-dddd-4ddd-8ddd-dddddddddddd	admin_user	Global Admin	admin@test.com	72dfd5faf944b537e2f5d111055abb18:8d9158f53577cf5884d6edbc58cfa1db961be1534c2b2b4d64f37d4b0a3ef0fcafcb4df1f6809d00205b896d61a126c5ecf0b087e31a35865b0e4b6297be7316	\N	Project Director & Tenant Admin	Director		[]	[]	t	2026-11-22 22:10:57.792141+07
cccccccc-cccc-4ccc-8ccc-cccccccccccc	viewer_user	Client Viewer A	viewer@test.com	72dfd5faf944b537e2f5d111055abb18:8d9158f53577cf5884d6edbc58cfa1db961be1534c2b2b4d64f37d4b0a3ef0fcafcb4df1f6809d00205b896d61a126c5ecf0b087e31a35865b0e4b6297be7316	\N	Client / Vendor Viewer	Client Rep		["11111111-1111-4111-8111-111111111111"]	[]	t	2026-11-22 22:10:57.792141+07
\.


--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, device_name, created_at) FROM stdin;
\.


--
-- Data for Name: work_nodes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.work_nodes (id, project_id, parent_id, wbs_code, name, weight_percent, planned_start_date, planned_end_date, document_reference_no, active_revision, claimed_progress_percent, verified_progress_percent, sort_order, created_at, updated_at) FROM stdin;
b1111111-1111-4111-8111-111111111111	22222222-2222-4222-8222-222222222222	\N	1.0	Foundation Beta	100.00	\N	\N	\N	\N	0	0	1	2026-11-22 22:10:57.801635+07	2026-11-22 22:10:57.801635+07
\.


--
-- Data for Name: work_stages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.work_stages (id, workflow_id, stage_order, stage_type, name, assigned_role, approval_role, checklist_schema, requires_wet_signature, status, actual_completed_at, forecast_completion_date, created_at) FROM stdin;
b3333333-3333-4333-8333-333333333333	b2222222-2222-4222-8222-222222222222	1	hold	Rebar Pre-pour Check	Field / QC Inspector	QA/QC Lead / Owner Inspector	[]	f	in_progress	\N	\N	2026-11-22 22:10:57.809621+07
\.


--
-- Data for Name: work_workflows; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.work_workflows (id, node_id, title, created_at) FROM stdin;
b2222222-2222-4222-8222-222222222222	b1111111-1111-4111-8111-111111111111	Foundation Beta Workflow	2026-11-22 22:10:57.805874+07
\.


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: checklist_templates checklist_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_pkey PRIMARY KEY (id);


--
-- Name: corrective_actions corrective_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_pkey PRIMARY KEY (id);


--
-- Name: daily_weather_logs daily_weather_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_weather_logs
    ADD CONSTRAINT daily_weather_logs_pkey PRIMARY KEY (id);


--
-- Name: evidence_attachments evidence_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.evidence_attachments
    ADD CONSTRAINT evidence_attachments_pkey PRIMARY KEY (id);


--
-- Name: inspection_attempts inspection_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspection_attempts
    ADD CONSTRAINT inspection_attempts_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_client_mutation_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_client_mutation_id_key UNIQUE (client_mutation_id);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: notification_settings notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_settings
    ADD CONSTRAINT notification_settings_pkey PRIMARY KEY (id);


--
-- Name: planned_curve_overrides planned_curve_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planned_curve_overrides
    ADD CONSTRAINT planned_curve_overrides_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (id);


--
-- Name: projects projects_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_code_key UNIQUE (code);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: punchlist_items punchlist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.punchlist_items
    ADD CONSTRAINT punchlist_items_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: tenant_profiles tenant_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenant_profiles
    ADD CONSTRAINT tenant_profiles_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: webauthn_credentials webauthn_credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: work_nodes work_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_nodes
    ADD CONSTRAINT work_nodes_pkey PRIMARY KEY (id);


--
-- Name: work_stages work_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_stages
    ADD CONSTRAINT work_stages_pkey PRIMARY KEY (id);


--
-- Name: work_workflows work_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_workflows
    ADD CONSTRAINT work_workflows_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: checklist_templates checklist_templates_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: checklist_templates checklist_templates_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: corrective_actions corrective_actions_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: corrective_actions corrective_actions_inspection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE CASCADE;


--
-- Name: corrective_actions corrective_actions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;


--
-- Name: daily_weather_logs daily_weather_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_weather_logs
    ADD CONSTRAINT daily_weather_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: daily_weather_logs daily_weather_logs_recorded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_weather_logs
    ADD CONSTRAINT daily_weather_logs_recorded_by_id_fkey FOREIGN KEY (recorded_by_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: evidence_attachments evidence_attachments_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.evidence_attachments
    ADD CONSTRAINT evidence_attachments_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.inspection_attempts(id) ON DELETE CASCADE;


--
-- Name: evidence_attachments evidence_attachments_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.evidence_attachments
    ADD CONSTRAINT evidence_attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: inspection_attempts inspection_attempts_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspection_attempts
    ADD CONSTRAINT inspection_attempts_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inspection_attempts inspection_attempts_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspection_attempts
    ADD CONSTRAINT inspection_attempts_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.work_stages(id) ON DELETE CASCADE;


--
-- Name: inspection_attempts inspection_attempts_submitter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspection_attempts
    ADD CONSTRAINT inspection_attempts_submitter_id_fkey FOREIGN KEY (submitter_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: inspections inspections_inspector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: inspections inspections_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;


--
-- Name: inspections inspections_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.checklist_templates(id) ON DELETE RESTRICT;


--
-- Name: planned_curve_overrides planned_curve_overrides_overridden_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planned_curve_overrides
    ADD CONSTRAINT planned_curve_overrides_overridden_by_id_fkey FOREIGN KEY (overridden_by_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: planned_curve_overrides planned_curve_overrides_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planned_curve_overrides
    ADD CONSTRAINT planned_curve_overrides_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: punchlist_items punchlist_items_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.punchlist_items
    ADD CONSTRAINT punchlist_items_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: punchlist_items punchlist_items_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.punchlist_items
    ADD CONSTRAINT punchlist_items_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.inspection_attempts(id) ON DELETE SET NULL;


--
-- Name: punchlist_items punchlist_items_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.punchlist_items
    ADD CONSTRAINT punchlist_items_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: punchlist_items punchlist_items_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.punchlist_items
    ADD CONSTRAINT punchlist_items_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.work_nodes(id) ON DELETE CASCADE;


--
-- Name: punchlist_items punchlist_items_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.punchlist_items
    ADD CONSTRAINT punchlist_items_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.work_stages(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: work_nodes work_nodes_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_nodes
    ADD CONSTRAINT work_nodes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: work_stages work_stages_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_stages
    ADD CONSTRAINT work_stages_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.work_workflows(id) ON DELETE CASCADE;


--
-- Name: work_workflows work_workflows_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_workflows
    ADD CONSTRAINT work_workflows_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.work_nodes(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict iLycuyXrfk3HggYQaWen9eSb7aoiagnj6Xuf8ymXznavzDgQ5IGvWTvWPgb3ocU

