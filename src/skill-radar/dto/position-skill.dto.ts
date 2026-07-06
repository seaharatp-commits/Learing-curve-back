import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class PositionSkillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(5)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
