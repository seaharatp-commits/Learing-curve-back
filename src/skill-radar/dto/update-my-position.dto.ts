import { IsString, MinLength } from "class-validator";

export class UpdateMyPositionDto {
  @IsString()
  @MinLength(1)
  positionId!: string;
}
