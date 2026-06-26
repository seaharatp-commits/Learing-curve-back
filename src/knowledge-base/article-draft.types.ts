export interface ArticleDraft {
  title: string;
  summary: string;
  symptoms: string;
  environment: string;
  rootCause: string;
  resolution: string;
  verification: string;
  keywords: string[];
  tags: string[];
  category: string;
}

export interface ArticleFields {
  title: string;
  summary: string | null;
  symptoms: string | null;
  environment: string | null;
  rootCause: string | null;
  resolution: string | null;
  verification: string | null;
  keywords: string[];
  tags: string[];
  category: string;
}
