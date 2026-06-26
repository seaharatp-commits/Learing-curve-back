import { IsArray, IsOptional, IsString, MinLength } from "class-validator";

export class ConfirmKnowledgeDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  summary!: string;

  @IsString()
  symptoms!: string;

  @IsString()
  environment!: string;

  @IsString()
  rootCause!: string;

  @IsString()
  resolution!: string;

  @IsString()
  verification!: string;

  @IsArray()
  @IsString({ each: true })
  keywords!: string[];

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsString()
  @MinLength(1)
  category!: string;

  @IsString()
  originalText!: string;

  @IsOptional()
  @IsString()
  targetArticleId?: string;
}
