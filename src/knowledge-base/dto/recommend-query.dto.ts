import { IsOptional, IsString, MinLength } from "class-validator";

export class RecommendQueryDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
