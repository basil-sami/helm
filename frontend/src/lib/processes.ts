// Marketing process templates — one click spawns the whole workflow as
// tasks with staggered due dates (offset = days after the anchor date).
export interface ProcTask {
  t: { ar: string; en: string };
  offset: number;
  priority: "LOW" | "MEDIUM" | "HIGH";
}
export interface ProcessTemplate {
  key: string;
  name: { ar: string; en: string };
  tasks: ProcTask[];
}

export const PROCESS_TEMPLATES: ProcessTemplate[] = [
  {
    key: "campaign_launch",
    name: { ar: "إطلاق حملة", en: "Campaign launch" },
    tasks: [
      { t: { ar: "تحديد الهدف ومؤشرات الأداء", en: "Define objective & KPIs" }, offset: 0, priority: "HIGH" },
      { t: { ar: "موجز الجمهور والرسالة", en: "Audience & message brief" }, offset: 1, priority: "HIGH" },
      { t: { ar: "اعتماد توزيع الميزانية", en: "Budget allocation approved" }, offset: 2, priority: "HIGH" },
      { t: { ar: "موجز التصاميم والمواد", en: "Creative assets brief" }, offset: 2, priority: "MEDIUM" },
      { t: { ar: "إنتاج المحتوى", en: "Content production" }, offset: 5, priority: "MEDIUM" },
      { t: { ar: "تجهيز القنوات والتتبع", en: "Channel setup & tracking" }, offset: 7, priority: "MEDIUM" },
      { t: { ar: "مراجعة واعتماد داخلي", en: "Internal review & approval" }, offset: 9, priority: "HIGH" },
      { t: { ar: "الإطلاق", en: "Launch" }, offset: 10, priority: "HIGH" },
      { t: { ar: "فحص الأداء (اليوم الثالث)", en: "Day-3 performance check" }, offset: 13, priority: "MEDIUM" },
    ],
  },
  {
    key: "event_prep",
    name: { ar: "تحضير فعالية", en: "Event preparation" },
    tasks: [
      { t: { ar: "حجز المكان", en: "Venue booking" }, offset: 0, priority: "HIGH" },
      { t: { ar: "المتحدثون وجدول الأعمال", en: "Speakers & agenda" }, offset: 3, priority: "MEDIUM" },
      { t: { ar: "الدعوات وصفحة التسجيل", en: "Invitations & registration" }, offset: 5, priority: "HIGH" },
      { t: { ar: "تصميم الجناح والمطبوعات", en: "Booth & collateral design" }, offset: 7, priority: "MEDIUM" },
      { t: { ar: "خطة الإعلام والتواصل", en: "Media & social plan" }, offset: 8, priority: "MEDIUM" },
      { t: { ar: "قائمة اللوجستيات", en: "Logistics checklist" }, offset: 10, priority: "MEDIUM" },
      { t: { ar: "برنامج يوم الفعالية", en: "Event-day run sheet" }, offset: 12, priority: "HIGH" },
      { t: { ar: "متابعة ما بعد الفعالية واستيراد العملاء", en: "Post-event follow-up & leads import" }, offset: 14, priority: "HIGH" },
    ],
  },
  {
    key: "content_sprint",
    name: { ar: "سباق محتوى", en: "Content sprint" },
    tasks: [
      { t: { ar: "بحث الموضوع والكلمات المفتاحية", en: "Topic research & keywords" }, offset: 0, priority: "MEDIUM" },
      { t: { ar: "اعتماد المخطط", en: "Outline approval" }, offset: 1, priority: "MEDIUM" },
      { t: { ar: "المسودة", en: "Draft" }, offset: 3, priority: "MEDIUM" },
      { t: { ar: "التصميم والمرئيات", en: "Design & visuals" }, offset: 5, priority: "MEDIUM" },
      { t: { ar: "مراجعة واعتماد", en: "Review & approve" }, offset: 6, priority: "HIGH" },
      { t: { ar: "النشر والتوزيع", en: "Publish & distribute" }, offset: 7, priority: "HIGH" },
    ],
  },
  {
    key: "lead_followup",
    name: { ar: "متابعة عميل محتمل", en: "Lead follow-up cadence" },
    tasks: [
      { t: { ar: "مكالمة التواصل الأولى", en: "First contact call" }, offset: 0, priority: "HIGH" },
      { t: { ar: "إرسال ملف الشركة", en: "Send company profile" }, offset: 1, priority: "MEDIUM" },
      { t: { ar: "اجتماع التأهيل", en: "Qualification meeting" }, offset: 3, priority: "HIGH" },
      { t: { ar: "مسودة العرض", en: "Proposal draft" }, offset: 6, priority: "HIGH" },
      { t: { ar: "متابعة وخطة الإغلاق", en: "Follow-up & close plan" }, offset: 10, priority: "MEDIUM" },
    ],
  },
];
