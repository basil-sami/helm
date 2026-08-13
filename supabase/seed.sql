-- Pulse (نبض) — generic starter seed (Supabase / PostgreSQL)
-- Industry-neutral baseline for a NEW client instance:
--   built-in roles · the four built-in process templates · one clearly-labelled
--   sample of each core object · empty catalogs · NO users.
-- The first admin account is created by the built-in installer on first visit,
-- and the onboarding wizard captures branding, currency, business units & modules.
-- Run AFTER schema.sql. Idempotent-ish: clears app tables first.
-- For a full demo dataset (Saria flagship), run seed-demo.sql instead.

begin;

truncate feedback, assets, posts, influencer_collabs, influencers, press_items, media_contacts, customers, event_registrations, tracked_links, campaign_briefs, personas, segments, products, process_templates, roles, objectives, osint_signals, osint_topics, social_metrics, social_accounts, tasks, budget_entries,
         content_items, events, leads, campaigns, users restart identity cascade;

-- Built-in roles (industry-neutral) --------------------------------------
insert into roles (key, label, "labelAr", permissions, builtin) values
  ('HEAD',          'Head of Marketing', 'رئيس التسويق',        '{"admin":true,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read","studio":"write","agency":"write","automate":"write","research":"write"}',    true),
  ('DIGITAL',       'Digital Lead',      'مسؤول الرقمي',        '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"write","intel":"write","planning":"write","analytics":"read","brain":"read","studio":"write","agency":"write","automate":"write","research":"write"}', true),
  ('PAID_MEDIA',    'Paid Media',        'الإعلانات المدفوعة',  '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read","studio":"write","agency":"read","automate":"write","research":"write"}',  true),
  ('EVENTS',        'Events',            'الفعاليات',           '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read","studio":"write","agency":"read","automate":"write","research":"write"}',  true),
  ('CONTENT_BRAND', 'Content & Brand',   'المحتوى والعلامة',    '{"admin":false,"campaigns":"write","content":"write","leads":"write","events":"write","budget":"write","tasks":"write","social":"read","intel":"read","planning":"read","analytics":"read","brain":"read","studio":"write","agency":"read","automate":"write","research":"write"}',  true);

-- Fresh-instance settings baseline (wizard will overwrite) ---------------
update settings set
  "orgName"    = 'Your Organization',
  "orgNameAr"  = 'مؤسستك',
  "onboarded"  = false,
  "modules"    = '{}',
  "businessUnits" = '[]'
where id = 1;

-- Built-in process templates ---------------------------------------------
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

-- One clearly-labelled sample of each core object (owners unset) ---------
insert into campaigns (id, name, "nameAr", objective, status, channel, "budgetUsd") values
  ('aaaaaaaa-0000-0000-0000-00000000c001','Sample campaign','حملة تجريبية','A worked example — edit or delete me','PLANNING','SOCIAL', 1000);

insert into content_items (title, "titleAr", channel, status, "campaignId") values
  ('Sample content piece','محتوى تجريبي','SOCIAL','IDEA','aaaaaaaa-0000-0000-0000-00000000c001');

insert into leads (company, "contactName", source, stage, "valueUsd") values
  ('Sample lead Co.','—','OTHER','NEW', 500);

insert into tasks (title, status, priority) values
  ('Sample task — finish onboarding in Settings','TODO','MEDIUM');

insert into events (name, "nameAr", type, status) values
  ('Sample event','فعالية تجريبية','ACTIVATION','PLANNED');

-- Live search providers. Free ones are always on; metered ones start at a
-- deliberately small ceiling — X is pay-per-read and adds up quickly.
insert into search_budget (provider, "monthlyCapUsd", "costPerUnit", active) values
  ('WEB', 5.00, 0.010, true),
  ('X', 5.00, 0.005, false),
  ('REDDIT', 0, 0, true),
  ('YOUTUBE', 0, 0, true)
on conflict (provider) do nothing;

commit;

-- ── W4·D · seasonal packs ────────────────────────────────────────────
-- Seeded DATA, not a hardcoded assumption: a client in another market
-- deactivates this pack and installs their own, and no code changes.
-- Hijri events carry a hijri month/day and are resolved per year at read
-- time via Intl's Umm al-Qura calendar, so Ramadan moves correctly.
insert into seasonal_packs (key, name, "nameAr", region) values
  ('islamic', 'Islamic calendar', 'التقويم الهجري', 'GLOBAL'),
  ('sd',      'Sudan',            'السودان',        'SD')
on conflict (key) do nothing;

insert into seasonal_events ("packId", key, name, "nameAr", kind, calendar, month, day, "durationDays", "leadTimeDays")
select p.id, v.key, v.name, v.name_ar, v.kind, v.cal, v.mon, v.day, v.dur, v.lead
from seasonal_packs p
join (values
  ('islamic','ramadan_start','Ramadan begins','بداية رمضان','RELIGIOUS','HIJRI',9,1,30,30),
  ('islamic','eid_fitr','Eid al-Fitr','عيد الفطر','RELIGIOUS','HIJRI',10,1,3,21),
  ('islamic','eid_adha','Eid al-Adha','عيد الأضحى','RELIGIOUS','HIJRI',12,10,4,21),
  ('islamic','hijri_new_year','Hijri New Year','رأس السنة الهجرية','RELIGIOUS','HIJRI',1,1,1,10),
  ('sd','independence_day','Independence Day','عيد الاستقلال','NATIONAL','GREGORIAN',1,1,1,14),
  ('sd','back_to_school','Back to school','العودة إلى المدارس','SEASON','GREGORIAN',9,1,14,30)
) as v(pack,key,name,name_ar,kind,cal,mon,day,dur,lead) on v.pack = p.key
on conflict do nothing;

-- ── W4·E · template library ──────────────────────────────────────────
-- Kills the blank canvas. Seeded bilingual starting points, written under
-- the Bayan charter; each campaign template carries its brief so a new
-- user can reach ACTIVE without hitting the activation gate as a wall.
insert into process_templates (key, kind, name, "nameAr", description, "descriptionAr", builtin, tasks, definition) values
  ('tpl_product_launch', 'CAMPAIGN', 'Product launch', 'إطلاق منتج',
   'A six-week launch: brief, creative, scheduled posts, a landing page and a follow-up loop.',
   'إطلاق على ستة أسابيع: الموجز والتصاميم والمنشورات المجدولة وصفحة الهبوط ومتابعة العملاء.',
   true, '[]'::jsonb,
   '{"channel":"SOCIAL","objective":"Introduce a new range to existing distributors and capture qualified interest",
     "brief":{"objective":"Qualified distributor leads for the new range","keyMessage":"A range built for local conditions",
              "kpiMetric":"leads_new_30d","kpiTarget":40}}'::jsonb),
  ('tpl_seasonal_push', 'CAMPAIGN', 'Seasonal push', 'حملة موسمية',
   'A short campaign timed to a season, with an offer and offline attribution.',
   'حملة قصيرة مرتبطة بموسم، مع عرض وقياس للأثر خارج الإنترنت.',
   true, '[]'::jsonb,
   '{"channel":"PAID","objective":"Convert seasonal demand with a time-boxed offer",
     "brief":{"objective":"Orders during the season window","keyMessage":"A limited offer for the season",
              "kpiMetric":"conversions_value_30d","kpiTarget":50000}}'::jsonb),
  ('tpl_reengage_dormant', 'CAMPAIGN', 'Re-engage dormant distributors', 'إعادة تفعيل الموزعين الخاملين',
   'Bring back distributors who have not ordered recently.',
   'استعادة الموزعين الذين لم يطلبوا مؤخرًا.',
   true, '[]'::jsonb,
   '{"channel":"BTL","objective":"Reopen conversations with dormant accounts",
     "brief":{"objective":"Reactivated distributor conversations","keyMessage":"We kept your terms",
              "kpiMetric":"leads_new_30d","kpiTarget":25}}'::jsonb),
  ('tpl_wf_new_lead', 'WORKFLOW', 'Welcome a new lead', 'الترحيب بعميل محتمل جديد',
   'On a new lead, notify the owner and open a follow-up task.',
   'عند وصول عميل محتمل جديد، أبلِغ المسؤول وافتح مهمة متابعة.',
   true, '[]'::jsonb,
   '{"trigger":{"event":"LEAD_CREATED","filters":{}},"actions":[{"type":"NOTIFY","message":"New lead received"}]}'::jsonb)
on conflict (key) do nothing;
