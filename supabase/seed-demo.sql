-- Pulse (نبض) — DEMO seed: the Saria Industrial Complex flagship dataset.
-- Use for demos, sales walkthroughs and the regression suite — NOT for real clients
-- (real clients start from the generic seed.sql + the built-in installer).
-- Safe to run on a fresh database. Demo password for all users: Pulse@2026
-- Run AFTER schema.sql. Idempotent-ish: clears app tables first.

begin;

truncate osint_case_items, osint_cases, osint_signal_entities, osint_aliases, osint_entities, files, mail_log, inbox_items, digest_log, key_results, web_events, sites, ad_spend, playbooks, partner_campaigns, partners, referrals, promotions, media_placements, media_plans,
         competitors, coverage_reports, outreach_touches, outreach_campaigns,
         wa_templates, lead_score_rules, workflow_runs, workflows,
         bio_links, bio_pages, scheduled_posts, content_variants, insights, survey_responses, surveys, landing_pages, form_submissions, forms, contacts, approvals, portal_tokens, invoices, deliverable_comments, deliverables, asset_versions, copy_bank, brand_assets, creative_briefs, creative_requests, engagements, vendors, feedback, assets, posts, influencer_collabs, influencers, press_items, media_contacts, customers, event_registrations, tracked_links, campaign_briefs, personas, segments, products, process_templates, roles, objectives, osint_signals, osint_topics, social_metrics, social_accounts, tasks, budget_entries,
         content_items, events, leads, campaigns, users restart identity cascade;

-- Roles (built-in) ------------------------------------------------------
insert into roles (key, label, "labelAr", permissions, builtin) values
  ('HEAD',          'Head of Marketing', 'رئيس التسويق',        '{"admin":true,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read","studio":"write","agency":"write","automate":"write","research":"write"}',    true),
  ('DIGITAL',       'Digital Lead',      'مسؤول الرقمي',        '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read","studio":"write","agency":"write","automate":"write","research":"write"}', true),
  ('PAID_MEDIA',    'Paid Media',        'الإعلانات المدفوعة',  '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read","studio":"write","agency":"read","automate":"write","research":"write"}',  true),
  ('EVENTS',        'Events',            'الفعاليات',           '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read","studio":"write","agency":"read","automate":"write","research":"write"}',  true),
  ('CONTENT_BRAND', 'Content & Brand',   'المحتوى والعلامة',    '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read","studio":"write","agency":"read","automate":"write","research":"write"}',  true);


update settings set
  "usdToSdgRate" = 2500,
  "orgName"      = 'Saria Industrial Complex',
  "orgNameAr"    = 'مجمع ساريا الصناعي',
  "accentColor"  = '#E8A33D',
  "localCurrency" = 'SDG',
  "localCurrencyAr" = 'ج.س',
  "businessUnits" = '["Batteries","Solar","Plastics","ICT"]',
  "modules"      = '{}',
  "onboarded"    = true
where id = 1;

-- Demo password hash = bcrypt('Pulse@2026')
-- Users -----------------------------------------------------------------
insert into users (id, name, email, "passwordHash", role, "titleAr") values
  ('11111111-1111-1111-1111-111111111111','Yousra Idris','head@saria.sd','$2a$10$yse94GgGKlDzAUCbxTOaY.GgdvU29COwAOPTZajCugy.Mvcwnq1Q.','HEAD','رئيس قسم التسويق'),
  ('22222222-2222-2222-2222-222222222222','Mazin Tarig','digital@saria.sd','$2a$10$yse94GgGKlDzAUCbxTOaY.GgdvU29COwAOPTZajCugy.Mvcwnq1Q.','DIGITAL','مسؤول التسويق الرقمي'),
  ('33333333-3333-3333-3333-333333333333','Rawan Osman','paid@saria.sd','$2a$10$yse94GgGKlDzAUCbxTOaY.GgdvU29COwAOPTZajCugy.Mvcwnq1Q.','PAID_MEDIA','مسؤول الإعلانات المدفوعة'),
  ('44444444-4444-4444-4444-444444444444','Khalid Babiker','events@saria.sd','$2a$10$yse94GgGKlDzAUCbxTOaY.GgdvU29COwAOPTZajCugy.Mvcwnq1Q.','EVENTS','مسؤول الفعاليات والأنشطة الميدانية'),
  ('55555555-5555-5555-5555-555555555555','Sara Hamid','content@saria.sd','$2a$10$yse94GgGKlDzAUCbxTOaY.GgdvU29COwAOPTZajCugy.Mvcwnq1Q.','CONTENT_BRAND','مسؤول المحتوى والعلامة التجارية');

-- Campaigns -------------------------------------------------------------
insert into campaigns (id, name, "nameAr", objective, status, channel, "startDate", "endDate", "budgetUsd", "budgetSdg", "businessUnit", "ownerId") values
  ('c0000001-0000-0000-0000-000000000001','Ramadan Battery Promotion','عرض بطاريات رمضان','Drive retail demand for Saria batteries during peak season','ACTIVE','SOCIAL', now()-interval '20 day', now()+interval '10 day', 12000, 30000000,'Batteries','22222222-2222-2222-2222-222222222222'),
  ('c0000002-0000-0000-0000-000000000002','SES Solar Solutions Launch','إطلاق حلول الطاقة الشمسية','Position SES as the local solar EPC partner','ACTIVE','PAID', now()-interval '5 day', now()+interval '40 day', 25000, 62500000,'SES','33333333-3333-3333-3333-333333333333'),
  ('c0000003-0000-0000-0000-000000000003','Plastics Distributor Drive','حملة موزعي البلاستيك','Recruit regional distributors for plastics line','PLANNING','BTL', now()+interval '15 day', now()+interval '60 day', 8000, 20000000,'Plastics','44444444-4444-4444-4444-444444444444'),
  ('c0000004-0000-0000-0000-000000000004','Saria — Made Locally','ساريا — صُنع محلياً','Corporate brand campaign on local manufacturing','ACTIVE','PR', now()-interval '30 day', now()+interval '30 day', 18000, 45000000,'Group','55555555-5555-5555-5555-555555555555'),
  ('c0000005-0000-0000-0000-000000000005','Odoo ERP Awareness','التوعية بنظام أودو','Generate ERP implementation leads','PAUSED','EMAIL', now()-interval '45 day', now()-interval '5 day', 6000, 15000000,'SES','22222222-2222-2222-2222-222222222222');

-- Content ---------------------------------------------------------------
insert into content_items (title, "titleAr", channel, status, "scheduledAt", "campaignId", "authorId") values
  ('Ramadan battery offer reel','ريل عرض البطاريات','SOCIAL','PUBLISHED', now()-interval '3 day','c0000001-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555'),
  ('Solar ROI calculator post','منشور حاسبة عائد الطاقة الشمسية','SOCIAL','REVIEW', now()+interval '2 day','c0000002-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222'),
  ('Customer story: factory off-grid','قصة عميل: مصنع خارج الشبكة','WEB','IN_PROGRESS', now()+interval '5 day','c0000002-0000-0000-0000-000000000002','55555555-5555-5555-5555-555555555555'),
  ('Made-locally brand film','فيلم صُنع محلياً','PR','APPROVED', now()+interval '7 day','c0000004-0000-0000-0000-000000000004','55555555-5555-5555-5555-555555555555'),
  ('Distributor recruitment one-pager','نشرة استقطاب الموزعين','BTL','IDEA', now()+interval '12 day','c0000003-0000-0000-0000-000000000003','44444444-4444-4444-4444-444444444444'),
  ('Odoo webinar invite email','دعوة ندوة أودو','EMAIL','IDEA', now()+interval '9 day','c0000005-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222'),
  ('Battery quality explainer','شرح جودة البطاريات','SOCIAL','IN_PROGRESS', now()+interval '4 day','c0000001-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');

-- Leads -----------------------------------------------------------------
insert into leads (company, "contactName", source, "businessUnit", stage, "valueUsd", "valueSdg", "ownerId", email) values
  ('Ministry of Energy','Eng. Tarig A.','Exhibition','SES','PROPOSAL',120000,300000000,'33333333-3333-3333-3333-333333333333','procurement@energy.gov.sd'),
  ('Blue Nile Contracting','Mr. Osman','Web form','SES','QUALIFIED',45000,112500000,'22222222-2222-2222-2222-222222222222',null),
  ('Khartoum Mall Group','Ms. Amani','Referral','Batteries','NEGOTIATION',30000,75000000,'11111111-1111-1111-1111-111111111111',null),
  ('Gezira Agri Co.','Mr. Fadl','Exhibition','Plastics','NEW',18000,45000000,'44444444-4444-4444-4444-444444444444',null),
  ('Red Sea Logistics','Capt. Idris','Web form','SES','WON',80000,200000000,'33333333-3333-3333-3333-333333333333',null),
  ('Nile Cement','Eng. Suad','Referral','SES','LOST',60000,150000000,'22222222-2222-2222-2222-222222222222',null),
  ('Omdurman Hospital','Dr. Hind','Web form','SES','QUALIFIED',95000,237500000,'11111111-1111-1111-1111-111111111111',null);

-- Events ----------------------------------------------------------------
insert into events (name, "nameAr", type, venue, city, "startDate", "endDate", status, "budgetUsd", "budgetSdg", "ownerId") values
  ('Khartoum International Fair','معرض الخرطوم الدولي','Exhibition','Khartoum Fairground','Khartoum', now()+interval '18 day', now()+interval '25 day','CONFIRMED',15000,37500000,'44444444-4444-4444-4444-444444444444'),
  ('Solar Energy Expo','معرض الطاقة الشمسية','Exhibition','Friendship Hall','Khartoum', now()+interval '45 day', now()+interval '47 day','PLANNED',9000,22500000,'44444444-4444-4444-4444-444444444444'),
  ('SES ICT Roadshow — Port Sudan','جولة تقنية المعلومات — بورتسودان','Activation','Coral Hotel','Port Sudan', now()-interval '2 day', now()+interval '1 day','RUNNING',5000,12500000,'44444444-4444-4444-4444-444444444444'),
  ('Distributor Day','يوم الموزعين','Conference','Saria HQ','Khartoum', now()+interval '30 day', now()+interval '30 day','PLANNED',4000,10000000,'44444444-4444-4444-4444-444444444444');

-- Budget ----------------------------------------------------------------
insert into budget_entries (label, kind, channel, "amountUsd", "amountSdg", date, "campaignId") values
  ('Meta ads — Ramadan','SPENT','PAID',4200,10500000, now()-interval '8 day','c0000001-0000-0000-0000-000000000001'),
  ('Google ads — Solar','SPENT','PAID',6800,17000000, now()-interval '3 day','c0000002-0000-0000-0000-000000000002'),
  ('Influencer batch','SPENT','SOCIAL',2500,6250000, now()-interval '6 day','c0000001-0000-0000-0000-000000000001'),
  ('PR newswire','SPENT','PR',1800,4500000, now()-interval '12 day','c0000004-0000-0000-0000-000000000004'),
  ('Fair booth deposit','SPENT','EVENT',5000,12500000, now()-interval '1 day',null),
  ('Q3 paid media plan','PLANNED','PAID',30000,75000000, now()+interval '20 day','c0000002-0000-0000-0000-000000000002'),
  ('BTL distributor drive','PLANNED','BTL',8000,20000000, now()+interval '15 day','c0000003-0000-0000-0000-000000000003'),
  ('Brand film production','PLANNED','PR',12000,30000000, now()+interval '10 day','c0000004-0000-0000-0000-000000000004');

-- Tasks -----------------------------------------------------------------
insert into tasks (title, status, priority, "dueDate", "assigneeId", "campaignId") values
  ('Approve solar ROI post','TODO','HIGH', now()+interval '1 day','11111111-1111-1111-1111-111111111111','c0000002-0000-0000-0000-000000000002'),
  ('Brief influencer batch 2','DOING','MEDIUM', now()+interval '3 day','22222222-2222-2222-2222-222222222222','c0000001-0000-0000-0000-000000000001'),
  ('Confirm fair booth design','DOING','HIGH', now()+interval '5 day','44444444-4444-4444-4444-444444444444',null),
  ('Finalize brand film script','TODO','MEDIUM', now()+interval '4 day','55555555-5555-5555-5555-555555555555','c0000004-0000-0000-0000-000000000004'),
  ('Reconcile May paid spend','DONE','LOW', now()-interval '2 day','33333333-3333-3333-3333-333333333333',null),
  ('Distributor list research','TODO','MEDIUM', now()+interval '7 day','44444444-4444-4444-4444-444444444444','c0000003-0000-0000-0000-000000000003');

-- Sample connected social accounts (status PENDING until real OAuth) -----
insert into social_accounts (id, platform, handle, "displayName", status) values
  ('a0000001-0000-0000-0000-000000000001','INSTAGRAM','@saria.industrial','Saria Industrial','PENDING'),
  ('a0000002-0000-0000-0000-000000000002','FACEBOOK','SariaIndustrial','Saria Industrial Complex','PENDING'),
  ('a0000003-0000-0000-0000-000000000003','LINKEDIN','saria-electronic-systems','Saria Electronic Systems','PENDING');

-- OSINT watch-topics (public market/brand/competitor intelligence) ------
insert into osint_topics (label, query, lang, region, category) values
  ('Saria brand mentions', '"Saria Industrial" OR "ساريا" OR "Saria Electronic Systems"', 'en', 'SD', 'BRAND'),
  ('Sudan solar energy market', 'Sudan solar energy OR "الطاقة الشمسية السودان"', 'en', 'SD', 'MARKET'),
  ('Sudan battery & power', 'Sudan battery OR "بطاريات السودان" OR power backup Sudan', 'en', 'SD', 'SECTOR'),
  ('Sudan ICT & ERP tenders', 'Sudan ICT tender OR Odoo Sudan OR "مناقصة تقنية المعلومات"', 'en', 'SD', 'MARKET'),
  ('Nile Power Systems (competitor)', '"Nile Power Systems" OR "أنظمة النيل للطاقة"', 'en', 'SD', 'COMPETITOR');

-- Strategy objectives / OKRs (windows span 2026 so live progress shows) ---
insert into objectives (label, "labelAr", metric, "targetValue", "startDate", "endDate", "businessUnit", "ownerId") values
  ('2026 qualified pipeline', 'خط الأنابيب المؤهل ٢٠٢٦', 'PIPELINE_USD', 500000, '2026-01-01', '2026-12-31', 'All', (select id from users where email='head@saria.sd')),
  ('H1 2026 new leads', 'عملاء محتملون جدد النصف الأول', 'LEADS_COUNT', 40, '2026-01-01', '2026-06-30', 'All', (select id from users where email='digital@saria.sd')),
  ('2026 won revenue', 'الإيرادات المكسوبة ٢٠٢٦', 'WON_USD', 150000, '2026-01-01', '2026-12-31', 'All', (select id from users where email='head@saria.sd')),
  ('Q2 content published', 'المحتوى المنشور الربع الثاني', 'CONTENT_PUBLISHED', 15, '2026-04-01', '2026-06-30', 'Marketing', (select id from users where email='content@saria.sd')),
  ('2026 marketing spend cap', 'سقف الإنفاق التسويقي ٢٠٢٦', 'SPEND_USD', 120000, '2026-01-01', '2026-12-31', 'All', (select id from users where email='head@saria.sd'));


commit;


-- Demo listening data (relative dates → the Listening page is alive on first run) --
insert into osint_signals ("topicId", source, "sourceType", title, lang, sentiment, "sentimentLabel", "publishedAt")
select t.id, v.source, v.stype, v.title, v.lang, v.sent, v.slabel, now() - (v.days || ' days')::interval
from (values
  -- Brand mentions: steady drumbeat, positive tilt, small spike this week
  ('Saria brand mentions','sudantribune.com','GOOGLE_NEWS','Saria expands solar assembly line in Khartoum North','en',0.7,'POS',2),
  ('Saria brand mentions','alrakoba.net','RSS','ساريا تعلن شراكة لتجميع البطاريات محلياً','ar',0.6,'POS',3),
  ('Saria brand mentions','medameek.com','RSS','قرّاء يسألون عن أسعار أنظمة ساريا الشمسية','ar',0.1,'NEU',4),
  ('Saria brand mentions','dabangasudan.org','GOOGLE_NEWS','Distributor lists Saria inverters in Port Sudan','en',0.3,'POS',5),
  ('Saria brand mentions','sudanakhbar.com','RSS','شكوى من تأخر صيانة في أحد مراكز الخدمة','ar',-0.5,'NEG',6),
  ('Saria brand mentions','gdelt','GDELT','Saria cited in industrial recovery briefing','en',0.4,'POS',9),
  ('Saria brand mentions','sudantribune.com','GOOGLE_NEWS','Solar assembly jobs announcement mentions Saria','en',0.5,'POS',12),
  ('Saria brand mentions','alrakoba.net','RSS','مقارنة بين مزودي الطاقة الشمسية في السودان','ar',0.0,'NEU',16),
  ('Saria brand mentions','medameek.com','RSS','ساريا ترعى معرض الخرطوم للصناعات','ar',0.6,'POS',20),
  ('Saria brand mentions','sudanakhbar.com','RSS','استفسارات عن ضمان بطاريات ساريا','ar',0.0,'NEU',24),
  ('Saria brand mentions','gdelt','GDELT','Regional supplier roundup includes Saria','en',0.2,'NEU',31),
  ('Saria brand mentions','dabangasudan.org','GOOGLE_NEWS','Saria ICT unit demos ERP rollout for factories','en',0.5,'POS',38),
  ('Saria brand mentions','sudantribune.com','GOOGLE_NEWS','Saria battery plant tour coverage','en',0.4,'POS',45),
  ('Saria brand mentions','alrakoba.net','RSS','تغطية إعلامية لمشروع طاقة شمسية بمشاركة ساريا','ar',0.5,'POS',52),
  -- Competitor mentions: thinner, mixed
  ('Nile Power Systems (competitor)','sudanakhbar.com','RSS','أنظمة النيل تطلق عرضاً على المحولات','ar',0.3,'POS',3),
  ('Nile Power Systems (competitor)','gdelt','GDELT','Nile Power Systems tender participation noted','en',0.1,'NEU',8),
  ('Nile Power Systems (competitor)','medameek.com','RSS','تباين آراء حول خدمة ما بعد البيع لدى أنظمة النيل','ar',-0.3,'NEG',13),
  ('Nile Power Systems (competitor)','sudantribune.com','GOOGLE_NEWS','Nile Power expands Omdurman showroom','en',0.4,'POS',22),
  ('Nile Power Systems (competitor)','alrakoba.net','RSS','مقال يذكر أنظمة النيل ضمن الموردين المحليين','ar',0.0,'NEU',30),
  ('Nile Power Systems (competitor)','gdelt','GDELT','Competitor pricing chatter in energy forum digest','en',-0.1,'NEU',41),
  ('Nile Power Systems (competitor)','sudanakhbar.com','RSS','أنظمة النيل ترعى ندوة الطاقة','ar',0.3,'POS',50),
  -- Market context (kept out of SOV, feeds volume/sources)
  ('Sudan solar energy market','dabangasudan.org','GOOGLE_NEWS','Solar import duties clarified for 2026','en',0.2,'NEU',2),
  ('Sudan solar energy market','sudantribune.com','GOOGLE_NEWS','Khartoum factories turn to hybrid solar-diesel power','en',0.3,'POS',10),
  ('Sudan battery & power','gdelt','GDELT','Battery demand rises with grid instability','en',-0.2,'NEU',18)
) as v(topic, source, stype, title, lang, sent, slabel, days)
join osint_topics t on t.label = v.topic;

-- Weekly platform snapshots per account (manual/CSV-style monitoring data) --
insert into social_metrics ("accountId", date, followers, posts, impressions, reach, engagement, source)
select a.id, (now() - (v.days || ' days')::interval)::date, v.f, v.p, v.imp, v.reach, v.eng, 'MANUAL'
from (values
  ('@saria.industrial', 28, 12180, 3, 20100, 15400, 610, 0),
  ('@saria.industrial', 21, 12310, 4, 22800, 17200, 700, 0),
  ('@saria.industrial', 14, 12475, 3, 21500, 16600, 655, 0),
  ('@saria.industrial',  7, 12640, 5, 26300, 20100, 940, 0),
  ('SariaIndustrial',   28, 33400, 4, 40100, 30800, 820, 0),
  ('SariaIndustrial',   21, 33520, 3, 37600, 28900, 760, 0),
  ('SariaIndustrial',   14, 33710, 4, 41900, 32400, 905, 0),
  ('SariaIndustrial',    7, 33880, 4, 43200, 33500, 980, 0),
  ('saria-electronic-systems', 28, 4120, 2, 6900, 5200, 210, 0),
  ('saria-electronic-systems', 21, 4180, 2, 7300, 5600, 235, 0),
  ('saria-electronic-systems', 14, 4230, 1, 6100, 4700, 190, 0),
  ('saria-electronic-systems',  7, 4295, 2, 7800, 6000, 265, 0)
) as v(handle, days, f, p, imp, reach, eng, pad)
join social_accounts a on a.handle = v.handle;

-- ═══ HUB seed (Phase A–C demo) ═══════════════════════════════════════
insert into process_templates (key, name, "nameAr", builtin, tasks) values
('campaign_launch','Campaign launch','إطلاق حملة',true,'[
 {"t":{"ar":"تحديد الهدف ومؤشرات الأداء","en":"Define objective & KPIs"},"offset":0,"priority":"HIGH"},
 {"t":{"ar":"موجز الجمهور والرسالة","en":"Audience & message brief"},"offset":1,"priority":"HIGH"},
 {"t":{"ar":"اعتماد توزيع الميزانية","en":"Budget allocation approved"},"offset":2,"priority":"HIGH"},
 {"t":{"ar":"موجز التصاميم والمواد","en":"Creative assets brief"},"offset":2,"priority":"MEDIUM"},
 {"t":{"ar":"إنتاج المحتوى","en":"Content production"},"offset":5,"priority":"MEDIUM"},
 {"t":{"ar":"تجهيز القنوات والتتبع","en":"Channel setup & tracking"},"offset":7,"priority":"MEDIUM"},
 {"t":{"ar":"مراجعة واعتماد داخلي","en":"Internal review & approval"},"offset":9,"priority":"HIGH"},
 {"t":{"ar":"الإطلاق","en":"Launch"},"offset":10,"priority":"HIGH"},
 {"t":{"ar":"فحص الأداء (اليوم الثالث)","en":"Day-3 performance check"},"offset":13,"priority":"MEDIUM"}]'),
('event_prep','Event preparation','تحضير فعالية',true,'[
 {"t":{"ar":"حجز المكان","en":"Venue booking"},"offset":0,"priority":"HIGH"},
 {"t":{"ar":"المتحدثون وجدول الأعمال","en":"Speakers & agenda"},"offset":3,"priority":"MEDIUM"},
 {"t":{"ar":"الدعوات وصفحة التسجيل","en":"Invitations & registration"},"offset":5,"priority":"HIGH"},
 {"t":{"ar":"تصميم الجناح والمطبوعات","en":"Booth & collateral design"},"offset":7,"priority":"MEDIUM"},
 {"t":{"ar":"خطة الإعلام والتواصل","en":"Media & social plan"},"offset":8,"priority":"MEDIUM"},
 {"t":{"ar":"قائمة اللوجستيات","en":"Logistics checklist"},"offset":10,"priority":"MEDIUM"},
 {"t":{"ar":"برنامج يوم الفعالية","en":"Event-day run sheet"},"offset":12,"priority":"HIGH"},
 {"t":{"ar":"متابعة ما بعد الفعالية واستيراد العملاء","en":"Post-event follow-up & leads import"},"offset":14,"priority":"HIGH"}]'),
('content_sprint','Content sprint','سباق محتوى',true,'[
 {"t":{"ar":"بحث الموضوع والكلمات المفتاحية","en":"Topic research & keywords"},"offset":0,"priority":"MEDIUM"},
 {"t":{"ar":"اعتماد المخطط","en":"Outline approval"},"offset":1,"priority":"MEDIUM"},
 {"t":{"ar":"المسودة","en":"Draft"},"offset":3,"priority":"MEDIUM"},
 {"t":{"ar":"التصميم والمرئيات","en":"Design & visuals"},"offset":5,"priority":"MEDIUM"},
 {"t":{"ar":"مراجعة واعتماد","en":"Review & approve"},"offset":6,"priority":"HIGH"},
 {"t":{"ar":"النشر والتوزيع","en":"Publish & distribute"},"offset":7,"priority":"HIGH"}]'),
('lead_followup','Lead follow-up cadence','متابعة عميل محتمل',true,'[
 {"t":{"ar":"مكالمة التواصل الأولى","en":"First contact call"},"offset":0,"priority":"HIGH"},
 {"t":{"ar":"إرسال ملف الشركة","en":"Send company profile"},"offset":1,"priority":"MEDIUM"},
 {"t":{"ar":"اجتماع التأهيل","en":"Qualification meeting"},"offset":3,"priority":"HIGH"},
 {"t":{"ar":"مسودة العرض","en":"Proposal draft"},"offset":6,"priority":"HIGH"},
 {"t":{"ar":"متابعة وخطة الإغلاق","en":"Follow-up & close plan"},"offset":10,"priority":"MEDIUM"}]');

insert into products (name, "nameAr", "businessUnit", category, "priceMinUsd", "priceMaxUsd") values
 ('NP7 Sealed Battery','بطارية NP7','Batteries','Power', 18, 30),
 ('5kW Hybrid Solar System','نظام شمسي هجين ٥ ك.و','Solar','Energy systems', 2800, 4200),
 ('Odoo ERP Implementation','تطبيق نظام أودو','ICT','Software services', 4000, 15000);

insert into segments (name, "nameAr", "businessUnit", kind, "sizeEstimate") values
 ('Battery distributors','موزعو البطاريات','Batteries','B2B_DISTRIBUTOR','~120 in Sudan'),
 ('Factories needing backup power','مصانع تحتاج طاقة احتياطية','Solar','B2B_ENTERPRISE','~300 Khartoum region');

insert into personas ("segmentId", name, "nameAr", goals, pains, channels, message, "messageAr") values
 ((select id from segments where name='Battery distributors'),'Distributor owner','صاحب محل توزيع',
  'Reliable supply, good margin','Fakes in market, FX volatility','["WHATSAPP","VISIT","EXPO"]',
  'Genuine stock, dealer pricing, fast Khartoum delivery','منتج أصلي وسعر موزع وتوصيل سريع'),
 ((select id from segments where name='Battery distributors'),'Purchasing manager','مدير مشتريات',
  'Total cost & warranty','Downtime risk','["EMAIL","CALL"]','Warranty-backed supply contracts','عقود توريد بضمان'),
 ((select id from segments where name='Factories needing backup power'),'Factory operations manager','مدير عمليات مصنع',
  'Uninterrupted production','Diesel cost, outages','["WHATSAPP","SITE_VISIT"]',
  'Hybrid solar cuts diesel spend 40%','النظام الهجين يخفض الديزل ٤٠٪');

insert into media_contacts (name, outlet, role, phone, beat, tier) values
 ('Mohamed Idris','Sudan Tribune','Business editor','+249912000001','Industry & energy','TIER1'),
 ('Sara Al-Tayeb','Alrakoba','Economy desk','+249912000002','Markets','TIER2');

insert into press_items (title, "contactId", status) values
 ('Saria solar assembly expansion story', (select id from media_contacts where name='Mohamed Idris'), 'PITCHED');

insert into influencers (name, platform, handle, audience, niche, "rateUsd", rating) values
 ('Khalid Tech SD','FACEBOOK','khalid.tech.sd', 85000, 'Tech & energy reviews', 150, 4);

insert into posts ("contentId", platform, "publishedAt", reach, impressions, engagement, clicks) values
 ((select id from content_items limit 1),'FACEBOOK', now() - interval '6 days', 15200, 19800, 640, 210),
 ((select id from content_items limit 1),'INSTAGRAM', now() - interval '5 days', 8900, 11400, 512, 96);

-- ═══ Wave 1·A demo: Studio + Agency (Saria flagship) ═════════════════
insert into vendors (id, name, kind, phone, email, contacts, "rateCard", notes) values
 ('cccccccc-0000-0000-0000-00000000c001','Bureau One Creative','AGENCY','+249-91-000-0001','studio@bureauone.example','[{"name":"Lina Awad","role":"Account lead"}]','[{"item":"Social visual","usd":120},{"item":"Video 60s","usd":900}]','Primary retained agency — brand & social.'),
 ('cccccccc-0000-0000-0000-00000000c002','Khartoum Print House','PRINTER','+249-91-000-0002',null,'[]','[{"item":"Rollup banner","usd":45}]','Event collateral & POS.');

insert into engagements (id, "vendorId", title, scope, "campaignIds", "feeUsd", "rateAtEntry", "startDate", "endDate", status, "ownerId") values
 ('dddddddd-0000-0000-0000-00000000d001','cccccccc-0000-0000-0000-00000000c001','Solar campaign creative retainer','Monthly social visuals + 1 hero video for the solar push','[]', 2400, 2500, now() - interval '20 days', now() + interval '40 days','ACTIVE','11111111-1111-1111-1111-111111111111');

insert into creative_requests (id, title, brief, kind, priority, status, "requesterId", "assigneeId", "dueDate", "slaDueAt") values
 ('eeeeeeee-0000-0000-0000-00000000e001','Ramadan battery promo key visual','Warm family scene, NP7 hero shot, bilingual headline','DESIGN','HIGH','IN_PROGRESS','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555', now() + interval '4 days', now() + interval '4 days'),
 ('eeeeeeee-0000-0000-0000-00000000e002','Distributor pitch deck refresh','Update numbers + new brand system','OTHER','MEDIUM','NEW','22222222-2222-2222-2222-222222222222',null, now() + interval '10 days', now() + interval '10 days');

insert into creative_briefs (id, title, "requestId", "engagementId", spec, format, refs, "dueDate") values
 ('ffffffff-0000-0000-0000-0000000f0001','Hero video — 5kW hybrid launch', null,'dddddddd-0000-0000-0000-00000000d001','60s, Arabic VO with EN subs, rooftop install story, end on tracked-link QR','MP4 1080x1920','["https://example.com/moodboard"]', now() + interval '12 days');

insert into deliverables (id, "engagementId", title, "briefId", "dueDate", status, "revisionCount", "submittedUrl", "submittedAt") values
 ('99999999-0000-0000-0000-000000009001','dddddddd-0000-0000-0000-00000000d001','Hero video — cut 1','ffffffff-0000-0000-0000-0000000f0001', now() + interval '12 days','IN_PROGRESS',0,null,null),
 ('99999999-0000-0000-0000-000000009002','dddddddd-0000-0000-0000-00000000d001','July social visuals (x8)',null, now() - interval '2 days','SUBMITTED',1,'https://example.com/drive/july-visuals', now() - interval '1 day');

insert into deliverable_comments ("deliverableId", author, "authorName", body) values
 ('99999999-0000-0000-0000-000000009002','VENDOR','Lina Awad','Second round uploaded — swapped the blue background per feedback.'),
 ('99999999-0000-0000-0000-000000009002','INTERNAL','Sara Hamid','Reviewing today, thanks.');

insert into invoices ("vendorId", "engagementId", number, "amountUsd", "rateAtEntry", status) values
 ('cccccccc-0000-0000-0000-00000000c001','dddddddd-0000-0000-0000-00000000d001','BO-2026-014', 2400, 2500,'RECEIVED');

insert into brand_assets (kind, label, "labelAr", value, url, public, sort) values
 ('LOGO','Primary logo','الشعار الأساسي',null,'https://example.com/brand/saria-logo.svg',true,0),
 ('COLOR','Saria amber','العنبري','#E8A33D',null,true,1),
 ('COLOR','Ink','الحبري','#0E1117',null,true,2),
 ('FONT','IBM Plex Sans Arabic','الخط الأساسي','IBM Plex Sans Arabic',null,true,3),
 ('TONE','Voice','نبرة الصوت','Confident, industrial, warm. Arabic first; short sentences.',null,true,4);

insert into copy_bank (text, "textAr", kind, approved) values
 ('Power that outlasts the outage.','طاقة تدوم أطول من الانقطاع.','TAGLINE',true),
 ('Order today — install this week.','اطلب اليوم — نركّب هذا الأسبوع.','CTA',true),
 ('Prices include VAT unless stated otherwise.','الأسعار تشمل الضريبة ما لم يُذكر خلاف ذلك.','DISCLAIMER',true);

insert into portal_tokens ("vendorId", token, "expiresAt", "createdById") values
 ('cccccccc-0000-0000-0000-00000000c001','demo-portal-bureau-one-2026', now() + interval '365 days','11111111-1111-1111-1111-111111111111');



-- ═══ Wave 1·B demo: Forms + Pages + Surveys + Contacts ═══════════════
insert into contacts (id, name, phone, email, company, tags, consent) values
 ('c0c0c0c0-0000-0000-0000-000000000001','Mohamed Idris','+249-91-222-1001','m.idris@example.sd','Idris Trading','["distributor"]','[{"channel":"WHATSAPP","grantedAt":"2026-06-10T09:00:00Z","source":"event"}]'),
 ('c0c0c0c0-0000-0000-0000-000000000002','Amani Osman','+249-91-222-1002','amani.o@example.sd',null,'["newsletter"]','[{"channel":"EMAIL","grantedAt":"2026-05-02T12:00:00Z","source":"web"},{"channel":"SMS","grantedAt":"2026-05-02T12:00:00Z","revokedAt":"2026-07-01T08:00:00Z","source":"web"}]'),
 ('c0c0c0c0-0000-0000-0000-000000000003','Khalid Babiker','+249-91-222-1003',null,'Babiker Farms','[]','[{"channel":"WHATSAPP","grantedAt":"2026-07-12T10:30:00Z","source":"form:solar-lead"}]');

insert into forms (id, name, slug, "campaignId", fields, "successMsg", "successMsgAr", active) values
 ('f0f0f0f0-0000-0000-0000-000000000001','Solar interest form','solar-lead',(select id from campaigns limit 1),
  '[{"key":"name","label":"Your name","labelAr":"الاسم","type":"text","required":true},{"key":"phone","label":"Phone (WhatsApp)","labelAr":"الهاتف (واتساب)","type":"phone","required":true},{"key":"email","label":"Email","labelAr":"البريد الإلكتروني","type":"email","required":false},{"key":"need","label":"What do you need?","labelAr":"ما احتياجك؟","type":"select","required":true,"options":["5kW hybrid","10kW hybrid","Batteries only"]}]',
  'Thank you! Our team will reach you within one working day.','شكرًا لك! سيتواصل معك فريقنا خلال يوم عمل واحد.',true);

insert into form_submissions ("formId", data, "contactId", src) values
 ('f0f0f0f0-0000-0000-0000-000000000001','{"name":"Khalid Babiker","phone":"+249-91-222-1003","need":"10kW hybrid"}','c0c0c0c0-0000-0000-0000-000000000003','solar-launch');

insert into landing_pages (id, slug, title, "titleAr", blocks, theme, "formId", "campaignId", status, views) values
 ('1a1a1a1a-0000-0000-0000-000000000001','solar-launch','Power that outlasts the outage','طاقة تدوم أطول من الانقطاع',
  '[{"kind":"HERO","heading":"Power that outlasts the outage","headingAr":"طاقة تدوم أطول من الانقطاع","sub":"Hybrid solar systems installed within one week — Khartoum & beyond.","subAr":"أنظمة شمسية هجينة تُركَّب خلال أسبوع — الخرطوم وما حولها."},{"kind":"FEATURES","items":[{"t":"Install in 7 days","tAr":"تركيب خلال ٧ أيام","d":"Site survey to switch-on.","dAr":"من المعاينة حتى التشغيل."},{"t":"2-year warranty","tAr":"ضمان سنتان","d":"Panels, inverter, and batteries.","dAr":"الألواح والانفرتر والبطاريات."},{"t":"Pay in SDG","tAr":"ادفع بالجنيه","d":"Local pricing, local support.","dAr":"تسعير محلي ودعم محلي."}]},{"kind":"TEXT","body":"Saria engineers size the system to your real load — no guesswork, no oversized quotes.","bodyAr":"مهندسو سارية يصمّمون النظام على حِملك الفعلي — بلا تخمين ولا عروض مبالغ فيها."},{"kind":"CTA","label":"Request a free site survey","labelAr":"اطلب معاينة مجانية"}]',
  '{}','f0f0f0f0-0000-0000-0000-000000000001',(select id from campaigns limit 1),'PUBLISHED', 214);

insert into surveys (id, name, "nameAr", slug, kind, questions, audience, "productId", active) values
 ('5e5e5e5e-0000-0000-0000-000000000001','Customer NPS — Summer 2026','مؤشر رضا العملاء — صيف ٢٠٢٦','nps-2026','NPS',
  '[{"key":"nps","text":"How likely are you to recommend Saria to a friend or colleague?","textAr":"ما احتمال أن توصي بسارية لصديق أو زميل؟","type":"SCALE","max":10,"required":true},{"key":"why","text":"What is the main reason for your score?","textAr":"ما السبب الرئيسي لتقييمك؟","type":"TEXT","required":false}]',
  'ANON',(select id from products limit 1),true);

insert into survey_responses ("surveyId", answers, score, "contactId") values
 ('5e5e5e5e-0000-0000-0000-000000000001','{"nps":9,"why":"Fast installation"}',9,'c0c0c0c0-0000-0000-0000-000000000001'),
 ('5e5e5e5e-0000-0000-0000-000000000001','{"nps":10,"why":"Great after-sales support"}',10,null),
 ('5e5e5e5e-0000-0000-0000-000000000001','{"nps":6,"why":"Price is high"}',6,null);

insert into insights (title, "titleAr", body, source, links, impact) values
 ('Price objection dominates detractors','اعتراض السعر يتصدر أسباب عدم الرضا','Detractor comments cluster on upfront price; financing/installment framing may unlock the segment.','SURVEY','{"productIds":[],"personaIds":[]}','HIGH'),
 ('Installation speed is the story','سرعة التركيب هي القصة','Promoters cite the 7-day install — lead with it in all solar creative.','SURVEY','{}','MEDIUM');


-- ── Wave 1·D — Publish demo: variants, queue, bio page ──────────────
insert into tracked_links (code, url, channel, "campaignId", clicks) values
 ('brand-film', 'https://saria.sd/film', 'SOCIAL', 'c0000004-0000-0000-0000-000000000004', 34),
 ('bio-order',  'https://saria.sd/order', 'WEB',   'c0000001-0000-0000-0000-000000000001', 87),
 ('bio-catalog','https://saria.sd/catalog','WEB',  null, 41);

insert into content_variants (id, "contentId", platform, caption, "captionAr", hashtags, format) values
 ('d1d1d1d1-0000-0000-0000-000000000001',
  (select id from content_items where status = 'APPROVED' limit 1),
  'INSTAGRAM',
  'Made locally, built to last — the Saria story.',
  'صُنع محليًا ليبقى — قصة ساريا.',
  '["saria","madeinsudan","solar"]', 'REEL'),
 ('d1d1d1d1-0000-0000-0000-000000000002',
  (select id from content_items where status = 'APPROVED' limit 1),
  'FACEBOOK',
  'Watch the Made-locally brand film.',
  'شاهد فيلم «صُنع محليًا».',
  '["saria"]', 'POST');

insert into scheduled_posts ("variantId", "scheduledAt", "assigneeId", status, "linkCode") values
 ('d1d1d1d1-0000-0000-0000-000000000001', now() + interval '1 day',
  '22222222-2222-2222-2222-222222222222', 'QUEUED', 'brand-film'),
 ('d1d1d1d1-0000-0000-0000-000000000002', now() + interval '3 days',
  '55555555-5555-5555-5555-555555555555', 'DRAFT', null);

insert into bio_pages (id, slug, title, "titleAr", theme) values
 ('b10b10b1-0000-0000-0000-000000000001', 'saria', 'Saria Industrial', 'ساريا الصناعية', '{"accent":"#c98a2b"}');

insert into bio_links ("pageId", label, "labelAr", "linkCode", sort) values
 ('b10b10b1-0000-0000-0000-000000000001', 'Order now',   'اطلب الآن',      'bio-order',   1),
 ('b10b10b1-0000-0000-0000-000000000001', 'Our catalog', 'كتالوج منتجاتنا','bio-catalog', 2),
 ('b10b10b1-0000-0000-0000-000000000001', 'Brand film',  'فيلم العلامة',   'brand-film',  3);


-- ── Wave 1·E — Automate demo: workflows, scoring, WA library ─────────
insert into workflows (id, name, "nameAr", trigger, actions, active) values
 ('a1a1a1a1-0000-0000-0000-000000000001','Web fast lane','مسار الويب السريع',
  '{"event":"lead.created","filters":{"source":"Web form"}}',
  '[{"type":"ASSIGN_OWNER","userId":"22222222-2222-2222-2222-222222222222"},
    {"type":"CREATE_TASK","title":"اتصال خلال ٢٤ ساعة","priority":"HIGH","dueInDays":1,"assigneeId":"22222222-2222-2222-2222-222222222222"},
    {"type":"SEND_WA_DRAFT","templateId":"aa11aa11-0000-0000-0000-000000000001"},
    {"type":"NOTIFY","message":"عميل جديد من نموذج الويب"}]', true),
 ('a1a1a1a1-0000-0000-0000-000000000002','Won bell','جرس الفوز',
  '{"event":"lead.stage_changed","filters":{"to":"WON"}}',
  '[{"type":"NOTIFY","message":"صفقة أُغلقت 🎉"}]', false);

insert into lead_score_rules (label, "labelAr", condition, points) values
 ('Exhibition lead','من معرض','{"field":"source","op":"eq","value":"Exhibition"}',35),
 ('Big deal (≥100k)','صفقة كبيرة (≥١٠٠ ألف)','{"field":"valueUsd","op":"gte","value":100000}',40),
 ('Web form lead','من نموذج الويب','{"field":"source","op":"eq","value":"Web form"}',20);

insert into wa_templates (id, name, "nameAr", body, "bodyAr", variables, category, uses) values
 ('aa11aa11-0000-0000-0000-000000000001','First follow-up','متابعة أولى',
  'Hi {{contactName}} 👋 we received your request regarding {{company}}. When suits you for a quick call — today or tomorrow? — Saria team',
  'أهلًا {{contactName}} 👋 وصلنا طلبك بخصوص {{company}}. متى يناسبك اتصال قصير — اليوم أم غدًا؟ — فريق صارية',
  '["contactName","company"]','FOLLOW_UP',12),
 ('aa11aa11-0000-0000-0000-000000000002','NPS invite','دعوة تقييم',
  'Your opinion matters! Rate your Saria experience in one minute: /s/nps-2026 🙏',
  'رأيك يهمنا! قيّم تجربتك مع صارية في دقيقة واحدة: /s/nps-2026 🙏',
  '[]','NPS',5);

-- cached scores as the rules above would compute them
update leads set score = 75, tags = '["exhibition","gov"]' where company = 'Ministry of Energy';
update leads set score = 60 where company = 'Red Sea Logistics';
update leads set score = 35 where company = 'Gezira Agri Co.';
update leads set score = 20 where company = 'Blue Nile Contracting';


-- ── Wave 1·F — Reach demo: sequences, health, coverage, competitors ──
insert into media_contacts (name, outlet, role, phone, beat, tier) values
 ('Khalid Osman','Ashorooq TV','Producer','+249912000003','Business news','TIER2');
update media_contacts set "lastContactAt" = now() - interval '6 days' where name = 'Mohamed Idris';
update media_contacts set "lastContactAt" = now() - interval '1 day'  where name = 'Sara Al-Tayeb';

insert into competitors (name, "nameAr", "listeningTopicId", notes) values
 ('Nile Power Systems','أنظمة النيل للطاقة',
  (select id from osint_topics where label = 'Nile Power Systems (competitor)'), 'Undercuts on battery pricing; weak after-sales'),
 ('Golden Wire Cables','أسلاك الذهبية', null, 'Cables only — overlaps SES on infrastructure bids');

insert into outreach_campaigns (id, name, "nameAr", goal, "audienceKind", steps, status) values
 ('0c0c0c0c-0000-0000-0000-000000000001','Battery launch — media relations','إطلاق البطارية — علاقات إعلامية',
  '3 placements this month','MEDIA',
  '[{"day":0,"channel":"WA","templateId":"aa11aa11-0000-0000-0000-000000000001"},{"day":3,"channel":"CALL"},{"day":7,"channel":"EMAIL"}]',
  'ACTIVE');

insert into outreach_touches ("campaignId","targetKind","targetId","targetName","stepNo",channel,"templateId","dueAt",status,note,"sentAt") values
 ('0c0c0c0c-0000-0000-0000-000000000001','MEDIA',(select id from media_contacts where name='Mohamed Idris'),'Mohamed Idris',1,'WA','aa11aa11-0000-0000-0000-000000000001', now() - interval '6 days','PLACED','نُشر تقرير التوسعة في سودان تريبيون', now() - interval '6 days'),
 ('0c0c0c0c-0000-0000-0000-000000000001','MEDIA',(select id from media_contacts where name='Mohamed Idris'),'Mohamed Idris',2,'CALL',null, now() - interval '3 days','SKIPPED',null,null),
 ('0c0c0c0c-0000-0000-0000-000000000001','MEDIA',(select id from media_contacts where name='Mohamed Idris'),'Mohamed Idris',3,'EMAIL',null, now() + interval '1 day','SKIPPED',null,null),
 ('0c0c0c0c-0000-0000-0000-000000000001','MEDIA',(select id from media_contacts where name='Sara Al-Tayeb'),'Sara Al-Tayeb',1,'WA','aa11aa11-0000-0000-0000-000000000001', now() - interval '1 day','SENT',null, now() - interval '1 day'),
 ('0c0c0c0c-0000-0000-0000-000000000001','MEDIA',(select id from media_contacts where name='Sara Al-Tayeb'),'Sara Al-Tayeb',2,'CALL',null, now() + interval '2 days','PLANNED',null,null),
 ('0c0c0c0c-0000-0000-0000-000000000001','MEDIA',(select id from media_contacts where name='Sara Al-Tayeb'),'Sara Al-Tayeb',3,'EMAIL',null, now() + interval '6 days','PLANNED',null,null);

insert into coverage_reports (title, "periodStart", "periodEnd", snapshot) values
 ('تغطية يونيو ٢٠٢٦ — June 2026 coverage','2026-06-01','2026-06-30',
  '{"pressCount":2,"press":[{"title":"Saria solar assembly expansion story","url":null,"publishedAt":"2026-06-18","contact":"Mohamed Idris","outlet":"Sudan Tribune"},{"title":"Local batteries beat imports on warranty","url":null,"publishedAt":"2026-06-25","contact":"Sara Al-Tayeb","outlet":"Alrakoba"}],"signalCount":34,"topics":[{"label":"Saria brand mentions","count":21},{"label":"Nile Power Systems (competitor)","count":13}],"sov":{"ownMentions":21,"competitorMentions":13,"sovPct":61.8,"perCompetitor":[{"name":"Nile Power Systems","count":13}]},"outreach":{"sent":9,"replied":4,"placed":2}}');


-- ═══ Wave 1·G — Connective Tissue demo ═══════════════════════════════

-- A converted customer (from the WON Red Sea lead) to anchor referrals
insert into customers (id, "leadId", company, "businessUnit", "firstWonAt", "totalValueUsd", "accountOwnerId")
values ('d0000001-0000-0000-0000-000000000001',
        (select id from leads where company='Red Sea Logistics' limit 1),
        'Red Sea Logistics', 'SES', now()-interval '30 day', 80000,
        (select id from users where email='head@saria.sd'));

-- Tracked links for the offline QR codes + the referral
insert into tracked_links (code, url, "campaignId", channel, clicks) values
  ('mp-demo1', 'https://saria.sd/offers/ramadan', 'c0000001-0000-0000-0000-000000000001', 'OFFLINE', 63),
  ('mp-demo2', 'https://saria.sd/offers/ramadan', 'c0000001-0000-0000-0000-000000000001', 'OFFLINE', 18),
  ('ref-demo1', 'https://saria.sd/solar', null, 'REFERRAL', 9);

-- Media plan: Ramadan billboards, two placements, real scans
insert into media_plans (id, name, "nameAr", period, channel, "budgetUsd", "campaignId") values
  ('e0000001-0000-0000-0000-000000000001', 'Ramadan billboards — Khartoum', 'لوحات رمضان — الخرطوم', 'Q1 2026', 'BILLBOARD', 15000, 'c0000001-0000-0000-0000-000000000001');
insert into media_placements ("planId", label, location, "startDate", "endDate", "costUsd", "linkCode") values
  ('e0000001-0000-0000-0000-000000000001', 'Airport Rd gantry 12×4', 'Khartoum', now()::date - 25, now()::date + 5, 6500, 'mp-demo1'),
  ('e0000001-0000-0000-0000-000000000001', 'Africa St bridge 8×3', 'Khartoum', now()::date - 25, now()::date + 5, 4200, 'mp-demo2');

-- Promotions
insert into promotions (name, "nameAr", code, kind, redemptions, active, "startsAt", "endsAt") values
  ('Eid battery deal', 'عرض بطاريات العيد', 'EID26', 'DISCOUNT', 47, true, now()::date - 10, now()::date + 20),
  ('Ramadan solar bundle', 'حزمة رمضان الشمسية', 'RAMADAN26', 'BUNDLE', 122, false, now()::date - 60, now()::date - 30);

-- Referrals: one live PENDING (open lead), one riding a WON lead
insert into referrals ("referrerCustomerId", code, "referredLeadId", "rewardState") values
  ('d0000001-0000-0000-0000-000000000001', 'ref-demo1',
   (select id from leads where company='Ministry of Energy' limit 1), 'PENDING');

-- Partners + one co-op link
insert into partners (id, name, "nameAr", kind, region, "coopBudgetUsd", contacts) values
  ('f0000001-0000-0000-0000-000000000001', 'Nile Power Distribution', 'النيل لتوزيع الطاقة', 'DISTRIBUTOR', 'Khartoum', 12000, '[{"name":"Mazin Ali","phone":"+249912000111"}]'),
  ('f0000002-0000-0000-0000-000000000002', 'Port Sudan Resellers Union', 'اتحاد بائعي بورتسودان', 'RESELLER', 'Red Sea', 6000, '[]');
insert into partner_campaigns ("partnerId", "campaignId", "sharePct") values
  ('f0000001-0000-0000-0000-000000000001', 'c0000001-0000-0000-0000-000000000001', 40);

-- Playbooks: the platform teaching its own craft
insert into playbooks (title, "titleAr", category, published, body) values
  ('Campaign launch SOP', 'دليل إطلاق حملة', 'CAMPAIGNS', true,
   E'١) حدّد الهدف والجمهور في «التخطيط».\n٢) اكتب البريف واربطه بالحملة.\n٣) جهّز المحتوى في الاستوديو واطلب الاعتماد.\n٤) جدول النشر من «النشر» — لا منشور بلا اعتماد.\n٥) فعّل كود QR إن وُجد إعلان خارجي.\n٦) راقب «صباح النبض» يوميًا وعدّل.'),
  ('Crisis comms checklist', 'قائمة اتصالات الأزمات', 'CRISIS', true,
   E'١) أوقف كل المنشورات المجدولة فورًا.\n٢) بيان موحّد خلال ٦٠ دقيقة — لا اجتهادات.\n٣) قناة داخلية واحدة للحقائق.\n٤) رُدّ على الوارد الاجتماعي من «الوارد» فقط.\n٥) وثّق كل شيء في السجل.');

-- Paid spend (flows into ROMI via the budget ledger at entry time in-app;
-- seeded rows are historical and already reflected in budget seed)
insert into ad_spend (platform, "campaignId", date, "amountUsd", "rateAtEntry", impressions, clicks) values
  ('META',   'c0000001-0000-0000-0000-000000000001', now()::date - 6, 850, 2500, 210000, 3400),
  ('META',   'c0000001-0000-0000-0000-000000000001', now()::date - 2, 640, 2500, 150000, 2600),
  ('TIKTOK', 'c0000002-0000-0000-0000-000000000002', now()::date - 4, 400, 2500, 98000, 1900);

-- pulse.js: the Saria site + a believable week of first-party traffic
insert into sites (id, name, domain, "snippetKey") values
  ('a0000001-0000-0000-0000-00000000000a', 'Saria main site', 'saria.sd', 'ps_saria01');
insert into web_events ("siteKey", kind, path, ref, utm, src, "visitorHash", at)
select 'ps_saria01', 'PAGEVIEW',
       (array['/','/products/battery-200','/products/battery-200','/solar','/offers/ramadan','/contact'])[1 + (g % 6)],
       (array[null,'https://facebook.com','https://instagram.com',null])[1 + (g % 4)],
       case when g % 4 = 1 then '{"utm_source":"fb","utm_campaign":"ramadan"}'::jsonb
            when g % 4 = 2 then '{"utm_source":"ig"}'::jsonb else '{}'::jsonb end,
       case when g % 7 = 0 then 'qr-airport' when g % 9 = 0 then 'bio' else null end,
       'vis' || (g % 9)::text,
       now() - (g % 7 || ' days')::interval - (g * 37 || ' minutes')::interval
from generate_series(1, 42) g;
insert into web_events ("siteKey", kind, path, "visitorHash", at) values
  ('ps_saria01', 'EVENT', 'quote_request', 'vis2', now() - interval '1 day'),
  ('ps_saria01', 'EVENT', 'quote_request', 'vis5', now() - interval '3 day');

-- Self-filling key results on the seeded objectives
insert into key_results ("objectiveId", label, "labelAr", metric, target, current, auto) values
  ((select id from objectives where label='H1 2026 new leads' limit 1),
   '40 qualified leads captured', '٤٠ عميلًا مؤهلًا', '{"metricKey":"leads_new_30d"}', 40, 0, true),
  ((select id from objectives where label='H1 2026 new leads' limit 1),
   'Site traffic momentum (7d)', 'زخم زيارات الموقع', '{"metricKey":"web_pageviews_7d"}', 60, 0, true),
  ((select id from objectives where label='2026 won revenue' limit 1),
   'Distributor agreements signed', 'اتفاقيات موزعين موقعة', '{}', 5, 2, false);

-- Social inbox: what arrived this morning
insert into inbox_items (platform, kind, author, text, status, "receivedAt") values
  ('IG', 'DM', '@fatima.solar', 'السلام عليكم، هل نظام ٥ كيلو واط يكفي منزل من طابقين؟ وكم السعر تقريبًا؟', 'OPEN', now() - interval '2 hour'),
  ('WA', 'DM', '+249 91 555 0142', 'نحتاج عرض سعر لعشرين بطارية ٢٠٠ أمبير للمصنع — عاجل', 'OPEN', now() - interval '5 hour'),
  ('FB', 'COMMENT', 'Omar Bashir', 'أفضل بطارية جربتها، الوكيل في بحري ممتاز 👏', 'REPLIED', now() - interval '1 day');


-- ═══ Wave 2·A — the GM wakes up to نبض ═══════════════════════════════
update users set "morningEmail" = true where email in ('head@saria.sd', 'digital@saria.sd');


-- ═══ Wave 2·C — a library that isn't an empty room ═══════════════════
insert into files (id, "key", name, mime, size, sha256, driver, data, public, entity, "uploadedById") values
  ('b1000001-0000-0000-0000-000000000001', 'demo/saria-logo.png', 'شعار سارية.png', 'image/png', 132,
   encode(sha256(decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKklEQVR4nGP8//8/AzGAiShVowaOGjhq4KiBowaOGjhq4KiBowaOGogfAAB0mQPBLcRvbAAAAABJRU5ErkJggg==', 'base64')), 'hex'), 'DB',
   decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKklEQVR4nGP8//8/AzGAiShVowaOGjhq4KiBowaOGjhq4KiBowaOGogfAAB0mQPBLcRvbAAAAABJRU5ErkJggg==', 'base64'), true, 'brand',
   (select id from users where email='head@saria.sd')),
  ('b1000002-0000-0000-0000-000000000002', 'demo/ramadan-kv.png', 'المفتاح البصري — رمضان.png', 'image/png', 132,
   encode(sha256(decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKklEQVR4nGP8//8/AzGAiShVowaOGjhq4KiBowaOGjhq4KiBowaOGogfAAB0mQPBLcRvbAAAAABJRU5ErkJggg==', 'base64')), 'hex'), 'DB',
   decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKklEQVR4nGP8//8/AzGAiShVowaOGjhq4KiBowaOGjhq4KiBowaOGogfAAB0mQPBLcRvbAAAAABJRU5ErkJggg==', 'base64'), true, 'library',
   (select id from users where email='digital@saria.sd')),
  ('b1000003-0000-0000-0000-000000000003', 'demo/battery-200.png', 'بطارية ٢٠٠ أمبير.png', 'image/png', 132,
   encode(sha256(decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKklEQVR4nGP8//8/AzGAiShVowaOGjhq4KiBowaOGjhq4KiBowaOGogfAAB0mQPBLcRvbAAAAABJRU5ErkJggg==', 'base64')), 'hex'), 'DB',
   decode('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKklEQVR4nGP8//8/AzGAiShVowaOGjhq4KiBowaOGjhq4KiBowaOGogfAAB0mQPBLcRvbAAAAABJRU5ErkJggg==', 'base64'), true, 'library',
   (select id from users where email='digital@saria.sd'));

-- the logo is the org logo, and the brand centre knows it
update settings set "logoUrl" = '/api/files/b1000001-0000-0000-0000-000000000001' where id = 1;
insert into brand_assets (kind, label, "labelAr", url, public, sort) values
  ('LOGO', 'Primary logo', 'الشعار الأساسي', '/api/files/b1000001-0000-0000-0000-000000000001', true, 0);


-- ═══ Wave 2·E P2/P3 — entities the demo can actually reason about ════
insert into osint_entities (id, kind, name, "nameAr", country, "isSelf") values
  ('e2000001-0000-0000-0000-000000000001', 'ORG', 'Saria Industrial Complex', 'مجمع سارية الصناعي', 'SD', true),
  ('e2000002-0000-0000-0000-000000000002', 'ORG', 'Nile Power Systems', 'النيل لأنظمة الطاقة', 'SD', false),
  ('e2000003-0000-0000-0000-000000000003', 'BRAND', 'Sun Energy', 'صن إنرجي', 'SD', false);

-- every way each name really appears in the wild
insert into osint_aliases ("entityId", surface, "surfaceNorm", lang, kind, weight) values
  ('e2000001-0000-0000-0000-000000000001', 'Saria Industrial Complex', 'saria industrial complex', 'en', 'EXACT', 1),
  ('e2000001-0000-0000-0000-000000000001', 'مجمع سارية الصناعي', 'مجمع ساريه الصناعي', 'ar', 'EXACT', 1),
  ('e2000001-0000-0000-0000-000000000001', 'سارية الصناعية', 'ساريه الصناعيه', 'ar', 'EXACT', 1),
  ('e2000001-0000-0000-0000-000000000001', 'Sariya', 'sariya', 'en', 'TRANSLITERATION', 0.9),
  ('e2000001-0000-0000-0000-000000000001', 'SIC', 'sic', 'en', 'ABBREVIATION', 0.6),
  ('e2000002-0000-0000-0000-000000000002', 'Nile Power Systems', 'nile power systems', 'en', 'EXACT', 1),
  ('e2000002-0000-0000-0000-000000000002', 'النيل لأنظمة الطاقة', 'النيل لانظمه الطاقه', 'ar', 'EXACT', 1),
  ('e2000003-0000-0000-0000-000000000003', 'Sun Energy', 'sun energy', 'en', 'EXACT', 1),
  ('e2000003-0000-0000-0000-000000000003', 'صن إنرجي', 'صن انرجي', 'ar', 'EXACT', 1);

-- bind entities to the competitors already in the demo, where they match
update osint_entities e set "competitorId" = c.id
  from competitors c where lower(c.name) = lower(e.name) and e."isSelf" = false;

-- an open case, mid-investigation
insert into osint_cases (id, title, "titleAr", question, "ownerId") values
  ('e3000001-0000-0000-0000-000000000001',
   'Did Nile Power cut prices in Port Sudan?', 'هل خفّضت النيل أسعارها في بورتسودان؟',
   'نحتاج مصدرين مستقلين قبل الرد في السوق — لا نتحرك على إشاعة.',
   (select id from users where email='head@saria.sd'));

-- Live-search ceilings (the truncate above clears them; a demo instance
-- must still ship with X off and the free providers on).
insert into search_budget (provider, "monthlyCapUsd", "costPerUnit", active) values
  ('WEB', 5.00, 0.010, true),
  ('X', 5.00, 0.005, false),
  ('REDDIT', 0, 0, true),
  ('YOUTUBE', 0, 0, true)
on conflict (provider) do update set
  "monthlyCapUsd" = excluded."monthlyCapUsd",
  "costPerUnit"   = excluded."costPerUnit",
  active          = excluded.active;

commit;
