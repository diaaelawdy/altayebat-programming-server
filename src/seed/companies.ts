export interface SeedCompany {
  name: string;
  nameAr: string;
  industry: string;
  website: string;
}

export const companies: SeedCompany[] = [
  { name: 'noon', nameAr: 'نون', industry: 'E-commerce', website: 'https://www.noon.com' },
  {
    name: 'Vodafone',
    nameAr: 'فودافون',
    industry: 'Telecom',
    website: 'https://www.vodafone.com.eg',
  },
  {
    name: 'PwC',
    nameAr: 'برايس ووترهاوس كوبرز',
    industry: 'Consulting',
    website: 'https://www.pwc.com',
  },
  {
    name: 'Siemens',
    nameAr: 'سيمنز',
    industry: 'Industrial tech',
    website: 'https://www.siemens.com',
  },
  { name: 'Valeo', nameAr: 'فاليو', industry: 'Automotive', website: 'https://www.valeo.com' },
  {
    name: 'Microsoft Egypt',
    nameAr: 'مايكروسوفت مصر',
    industry: 'Software',
    website: 'https://www.microsoft.com',
  },
  {
    name: 'Amazon',
    nameAr: 'أمازون',
    industry: 'E-commerce & Cloud',
    website: 'https://www.amazon.jobs',
  },
  { name: 'Fawry', nameAr: 'فوري', industry: 'Fintech', website: 'https://fawry.com' },
  { name: 'Dell', nameAr: 'ديل', industry: 'Hardware', website: 'https://www.dell.com' },
  { name: 'Orange', nameAr: 'أورنج', industry: 'Telecom', website: 'https://www.orange.eg' },
  { name: 'Paymob', nameAr: 'باي موب', industry: 'Fintech', website: 'https://paymob.com' },
  {
    name: 'IBM',
    nameAr: 'آي بي إم',
    industry: 'Software & Consulting',
    website: 'https://www.ibm.com',
  },
  {
    name: 'Instabug',
    nameAr: 'انستاباج',
    industry: 'Developer tools',
    website: 'https://www.instabug.com',
  },
  { name: 'Swvl', nameAr: 'سويفل', industry: 'Mobility', website: 'https://www.swvl.com' },
  {
    name: 'CyShield',
    nameAr: 'سايشيلد',
    industry: 'Cybersecurity',
    website: 'https://www.cyshield.com',
  },
  {
    name: 'Breadfast',
    nameAr: 'بريدفاست',
    industry: 'Quick commerce',
    website: 'https://www.breadfast.com',
  },
  {
    name: 'Giza Systems',
    nameAr: 'الجيزة سيستمز',
    industry: 'Systems integration',
    website: 'https://www.gizasystems.com',
  },
  {
    name: 'Link Development',
    nameAr: 'لينك ديفلوبمنت',
    industry: 'Software services',
    website: 'https://www.linkdev.com',
  },
  { name: 'Vezeeta', nameAr: 'فيزيتا', industry: 'Healthtech', website: 'https://www.vezeeta.com' },
  {
    name: 'ITWorx',
    nameAr: 'آي تي وركس',
    industry: 'Software services',
    website: 'https://www.itworx.com',
  },
  {
    name: 'Talabat',
    nameAr: 'طلبات',
    industry: 'Food delivery',
    website: 'https://www.talabat.com',
  },
  { name: 'Bosta', nameAr: 'بوسطة', industry: 'Logistics', website: 'https://bosta.co' },
  { name: 'Halan', nameAr: 'حالاً', industry: 'Fintech', website: 'https://halan.com' },
  {
    name: 'Analog Devices',
    nameAr: 'أنالوج ديفايسز',
    industry: 'Semiconductors',
    website: 'https://www.analog.com',
  },
  {
    name: 'Si-Ware',
    nameAr: 'سي-وير',
    industry: 'Semiconductors',
    website: 'https://www.si-ware.com',
  },
  {
    name: 'Synopsys',
    nameAr: 'سينوبسيس',
    industry: 'EDA software',
    website: 'https://www.synopsys.com',
  },
  { name: 'Etisalat', nameAr: 'اتصالات', industry: 'Telecom', website: 'https://www.etisalat.eg' },
  { name: 'Ejada', nameAr: 'إجادة', industry: 'IT services', website: 'https://www.ejada.com' },
  { name: 'Thndr', nameAr: 'ثندر', industry: 'Fintech', website: 'https://thndr.app' },
  { name: 'elmenus', nameAr: 'المنيوز', industry: 'Food tech', website: 'https://www.elmenus.com' },
  { name: 'Nagwa', nameAr: 'نجوى', industry: 'Edtech', website: 'https://www.nagwa.com' },
  {
    name: 'Telecom Egypt',
    nameAr: 'المصرية للاتصالات',
    industry: 'Telecom',
    website: 'https://te.eg',
  },
  { name: 'Intel', nameAr: 'إنتل', industry: 'Semiconductors', website: 'https://www.intel.com' },
];

/** Domains whose own site gives a better icon than the website field (or none at all). */
const LOGO_DOMAIN: Record<string, string> = {
  amazon: 'amazon.com',
  orange: 'orange.com',
  synopsys: 'www.synopsys.com',
  ejada: 'www.ejada.com',
};
const LOGO_URL: Record<string, string> = {
  elmenus: 'https://icons.duckduckgo.com/ip3/elmenus.com.ico',
};

/** A logo URL for a company from its website's icon; '' when there is no website. */
export function logoFor(slug: string, website: string) {
  if (LOGO_URL[slug]) return LOGO_URL[slug];
  let domain = LOGO_DOMAIN[slug];
  if (!domain) {
    try {
      domain = new URL(website).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}
