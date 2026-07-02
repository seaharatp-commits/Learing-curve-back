import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class ConfirmKnowledgeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MaxLength(1000)
  summary!: string;

  @IsString()
  @MaxLength(3000)
  symptoms!: string;

  @IsString()
  @MaxLength(2000)
  environment!: string;

  @IsString()
  @MaxLength(3000)
  rootCause!: string;

  @IsString()
  @MaxLength(6000)
  resolution!: string;

  @IsString()
  @MaxLength(3000)
  verification!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords!: string[];

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  tags!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

  @IsString()
  @MaxLength(12000)
  originalText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetArticleId?: string;
}
