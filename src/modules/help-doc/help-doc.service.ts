import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { HelpDoc } from './entities/help-doc.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';
import { QueryHelpDocDto } from './dto/help-doc.dto';

/** 种子文档 front-matter 元数据 */
interface DocFrontMatter {
  title: string;
  category: string;
  routePath?: string;
  sortOrder?: number;
}

/**
 * 帮助文档服务
 * 除标准 CRUD 外，提供已发布文档树、按路由匹配文档（上下文帮助）与种子灌入能力
 */
@Injectable()
export class HelpDocService extends BaseCrudService<HelpDoc> {
  private readonly logger = new Logger(HelpDocService.name);

  constructor(@InjectRepository(HelpDoc) repo: Repository<HelpDoc>) {
    super(repo, 'hd');
  }

  protected getSearchFields(): string[] {
    return ['title'];
  }

  protected getUpdatableFields(): string[] {
    return [
      'title',
      'category',
      'content',
      'routePath',
      'sortOrder',
      'status',
      'remark',
    ];
  }

  protected getNullableFields(): string[] {
    return ['routePath', 'remark'];
  }

  /** 分页查询（管理端：支持分类筛选，按排序号升序） */
  async findAll(
    query: QueryHelpDocDto,
  ): Promise<{ list: HelpDoc[]; total: number; page: number; pageSize: number }> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.repo.createQueryBuilder(this.alias);

    if (query.keyword) {
      qb.andWhere(`${this.alias}.title LIKE :kw`, { kw: `%${query.keyword}%` });
    }
    if (query.category) {
      qb.andWhere(`${this.alias}.category = :category`, {
        category: query.category,
      });
    }
    if (query.status !== undefined) {
      qb.andWhere(`${this.alias}.status = :status`, { status: query.status });
    }

    qb.orderBy(`${this.alias}.sortOrder`, 'ASC')
      .addOrderBy(`${this.alias}.createdTime`, 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /**
   * 已发布文档树（阅读端）
   * 按分类分组，分类内按排序号升序；列表不含正文以减小体积
   */
  async findPublishedTree(): Promise<
    { category: string; docs: Partial<HelpDoc>[] }[]
  > {
    const docs = await this.repo.find({
      where: { status: 1 },
      order: { sortOrder: 'ASC', createdTime: 'DESC' },
    });

    const groups = new Map<string, Partial<HelpDoc>[]>();
    for (const doc of docs) {
      const lite = {
        id: doc.id,
        title: doc.title,
        category: doc.category,
        routePath: doc.routePath,
        sortOrder: doc.sortOrder,
      };
      const bucket = groups.get(doc.category);
      if (bucket) {
        bucket.push(lite);
      } else {
        groups.set(doc.category, [lite]);
      }
    }

    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      docs: items,
    }));
  }

  /** 阅读端获取单篇已发布文档（草稿不对外） */
  async findOnePublished(id: string): Promise<HelpDoc> {
    const doc = await this.repo.findOne({ where: { id, status: 1 } });
    if (!doc) {
      throw new NotFoundException('文档不存在或未发布');
    }
    return doc;
  }

  /**
   * 按当前路由匹配帮助文档（上下文帮助入口）
   * 规则：routePath 支持逗号分隔多个前缀，命中 path === p || path.startsWith(p)，
   * 多个命中时取最长前缀（最精确绑定）
   */
  async matchByRoute(routePath: string): Promise<{ id: string; title: string } | null> {
    if (!routePath) return null;

    const docs = await this.repo.find({ where: { status: 1 } });
    let best: { id: string; title: string; len: number } | null = null;

    for (const doc of docs) {
      if (!doc.routePath) continue;
      const prefixes = doc.routePath
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      for (const p of prefixes) {
        if (routePath === p || routePath.startsWith(p)) {
          if (!best || p.length > best.len) {
            best = { id: doc.id, title: doc.title, len: p.length };
          }
        }
      }
    }

    return best ? { id: best.id, title: best.title } : null;
  }

  /** 删除文档 */
  async remove(id: string): Promise<{ id: string }> {
    const doc = await this.findOne(id);
    await this.repo.remove(doc);
    return { id };
  }

  /**
   * 种子文档灌入：仅当表为空时，读取 docs/help/*.md 写入
   * 每个 md 文件需包含 front-matter：title / category / routePath / sortOrder
   */
  async seedDocs(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;

    const dir = path.join(process.cwd(), 'docs', 'help');
    if (!fs.existsSync(dir)) {
      this.logger.warn(`种子文档目录不存在，跳过: ${dir}`);
      return;
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = this.parseFrontMatter(raw);
        if (!parsed) {
          this.logger.warn(`种子文档缺少 front-matter，跳过: ${file}`);
          continue;
        }
        await this.repo.save(
          this.repo.create({
            title: parsed.meta.title,
            category: parsed.meta.category,
            content: parsed.body,
            routePath: parsed.meta.routePath || null,
            sortOrder: parsed.meta.sortOrder ?? 0,
            status: 1,
          }),
        );
        this.logger.log(`已灌入种子文档: ${parsed.meta.title}`);
      } catch (e) {
        this.logger.error(`种子文档写入失败: ${file}`, (e as Error).stack);
      }
    }
  }

  /** 解析 front-matter（--- 包裹的 key: value 区块）与正文 */
  private parseFrontMatter(raw: string): {
    meta: DocFrontMatter;
    body: string;
  } | null {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return null;

    const meta: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && value) meta[key] = value;
    }

    if (!meta.title || !meta.category) return null;

    return {
      meta: {
        title: meta.title,
        category: meta.category,
        routePath: meta.routePath,
        sortOrder: meta.sortOrder ? parseInt(meta.sortOrder, 10) : undefined,
      },
      body: match[2].trim(),
    };
  }
}
