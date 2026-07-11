-- HELM seed data (Supabase / PostgreSQL)
-- Safe to run on a fresh database. Demo password for all users: Helm@2026
-- Run AFTER schema.sql. Idempotent-ish: clears app tables first.

begin;

truncate feedback, assets, posts, influencer_collabs, influencers, press_items, media_contacts, customers, event_registrations, tracked_links, campaign_briefs, personas, segments, products, process_templates, roles, objectives, osint_signals, osint_topics, social_metrics, social_accounts, tasks, budget_entries,
         content_items, events, leads, campaigns, users restart identity cascade;

-- Roles (built-in) ------------------------------------------------------
insert into roles (key, label, "labelAr", permissions, builtin) values
  ('HEAD',          'Head of Marketing', 'رئيس التسويق',        '{"admin":true,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read"}',    true),
  ('DIGITAL',       'Digital Lead',      'مسؤول الرقمي',        '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read"}', true),
  ('PAID_MEDIA',    'Paid Media',        'الإعلانات المدفوعة',  '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true),
  ('EVENTS',        'Events',            'الفعاليات',           '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true),
  ('CONTENT_BRAND', 'Content & Brand',   'المحتوى والعلامة',    '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read"}',  true);


update settings set "usdToSdgRate" = 2500 where id = 1;

-- Demo password hash = bcrypt('Helm@2026')
-- Users -----------------------------------------------------------------
insert into users (id, name, email, "passwordHash", role, "titleAr") values
  ('11111111-1111-1111-1111-111111111111','Yousra Idris','head@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','HEAD','رئيس قسم التسويق'),
  ('22222222-2222-2222-2222-222222222222','Mazin Tarig','digital@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','DIGITAL','مسؤول التسويق الرقمي'),
  ('33333333-3333-3333-3333-333333333333','Rawan Osman','paid@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','PAID_MEDIA','مسؤول الإعلانات المدفوعة'),
  ('44444444-4444-4444-4444-444444444444','Khalid Babiker','events@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','EVENTS','مسؤول الفعاليات والأنشطة الميدانية'),
  ('55555555-5555-5555-5555-555555555555','Sara Hamid','content@saria.sd','$2a$10$/DXtPrNqyI6Uk6mD2x8/Geeonk5ppNZbNFzGY.6mPLMEVtRg8x/Ra','CONTENT_BRAND','مسؤول المحتوى والعلامة التجارية');

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
